const axios = require("axios");
const config = require("./config");
const logger = require("./logger");
const { resolveCategoryFromRules } = require("./categoryRules");
const { getTemplateAttributesForCategory } = require("./categoryAttributes");

const apiClient = axios.create({
    baseURL: "https://api.mercadolibre.com",
    timeout: config.sync.timeoutMs,
    headers: {
        "Content-Type": "application/json"
    }
});

let accessToken = config.meli.accessToken;
let refreshToken = config.meli.refreshToken;
let userId = config.meli.userId;
const requiredAttributesCache = new Map();

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function computePrice(basePrice) {
    const multiplier = 1 + config.sync.markupPercent / 100;
    const calculated = Math.round(basePrice * multiplier * 100) / 100;
    const floorApplied = Math.max(calculated, config.sync.minPrice);

    if (String(config.sync.currencyId || "").toUpperCase() === "COP") {
        return Math.round(floorApplied);
    }

    return floorApplied;
}

function resolveAvailableQuantity(product) {
    if (Number.isFinite(product.availableQuantity)) {
        return Math.max(0, Math.floor(product.availableQuantity));
    }

    return Math.max(0, Math.floor(config.sync.defaultQuantity));
}

function buildTitle(product) {
    const suffix = product.optionValues && product.optionValues.length
        ? ` - ${product.optionValues.join(" / ")}`
        : "";
    const full = `${product.title}${suffix}`.trim();
    return full.slice(0, 60);
}

function buildFamilyName(product) {
    const candidates = [product.title, product.productType, product.vendor]
        .map((value) => (value || "").trim())
        .filter(Boolean);

    const withLetters = candidates.find((candidate) => /[A-Za-z]/.test(candidate));
    let preferred = withLetters || candidates[0] || "Producto";

    if (!/[A-Za-z]/.test(preferred)) {
        preferred = `${product.vendor || "Producto"} ${product.sku || ""}`.trim();
    }

    return preferred.slice(0, 60);
}

function isTitleBlockedByFamilyName(error) {
    if (!error.response || !error.response.data) {
        return false;
    }

    const data = error.response.data;
    const message = String(data.message || "").toLowerCase();
    const err = String(data.error || "").toLowerCase();
    const cause = String(data.cause || "").toLowerCase();
    const serializedCause = JSON.stringify(data.cause || "").toLowerCase();

    return message.includes("family_name")
        || err.includes("family_name")
        || cause.includes("family_name")
        || serializedCause.includes("family_name");
}

function isTitleInvalidForCreate(error) {
    if (!error.response || !error.response.data) {
        return false;
    }

    const data = error.response.data;
    const message = String(data.message || "").toLowerCase();
    const err = String(data.error || "").toLowerCase();
    const serializedCause = JSON.stringify(data.cause || "").toLowerCase();

    return (message.includes("title") && message.includes("invalid"))
        || (err.includes("title") && err.includes("invalid"))
        || (err.includes("fields [title] are invalid"))
        || (err.includes("invalid_fields") && serializedCause.includes("title"))
        || message.includes("fields [title] are invalid");
}

function isAttributesRequired(error) {
    if (!error.response || !error.response.data) {
        return false;
    }

    const data = error.response.data;
    const message = String(data.message || "").toLowerCase();
    const err = String(data.error || "").toLowerCase();

    return message.includes("attributes are required")
        || err.includes("attributes are required");
}

function isItemNotModifiable(error) {
    if (!error.response || !error.response.data) {
        return false;
    }

    const data = error.response.data;
    const message = String(data.message || "").toLowerCase();
    const causes = Array.isArray(data.cause) ? data.cause : [];
    const causeCodes = causes.map((cause) => String(cause.code || "").toLowerCase());

    return message.includes("under_review")
        || causeCodes.includes("field_not_updatable")
        || causeCodes.includes("item.price.not_modifiable");
}

function canRetryCreateWithDefaultCategory(error, discoveredCategoryId) {
    if (!config.meli.defaultCategoryId || config.meli.defaultCategoryId === discoveredCategoryId) {
        return false;
    }

    if (!error.response) {
        return false;
    }

    const status = error.response.status;
    const data = error.response.data || {};
    const err = String(data.error || "").toLowerCase();
    const message = String(data.message || "").toLowerCase();

    return status === 400
        || status === 404
        || err.includes("validation_error")
        || message.includes("validation")
        || isAttributesRequired(error)
        || isTitleInvalidForCreate(error);
}

async function postItem(payload) {
    return authorizedRequest(() =>
        apiClient.post("/items", payload, {
            headers: authHeaders()
        })
    );
}

function buildSaleTerms() {
    return [
        {
            id: "WARRANTY_TYPE",
            value_name: "Garantia del vendedor"
        },
        {
            id: "WARRANTY_TIME",
            value_name: "30 dias"
        }
    ];
}

async function getRequiredAttributesMetadata(categoryId) {
    if (requiredAttributesCache.has(categoryId)) {
        return requiredAttributesCache.get(categoryId);
    }

    const response = await apiClient.get(`/categories/${categoryId}/attributes`);
    const requiredAttributes = (response.data || []).filter((attribute) => {
        const tags = attribute.tags || {};
        return (Boolean(tags.required) || Boolean(tags.catalog_required)) && !Boolean(tags.read_only);
    });

    requiredAttributesCache.set(categoryId, requiredAttributes);
    return requiredAttributes;
}

function getDefaultAttributeValue(attribute, product) {
    if (attribute.id === "BRAND") {
        return (product.vendor || "Generica").slice(0, 120);
    }

    if (attribute.id === "MODEL") {
        const base = (product.variantTitle && product.variantTitle !== "Default Title")
            ? `${product.title} ${product.variantTitle}`
            : product.title;
        return (base || product.sku || "Modelo estandar").slice(0, 120);
    }

    if (attribute.value_type === "number_unit") {
        const firstUnit = (attribute.allowed_units || [])[0];
        const unit = firstUnit && firstUnit.name ? firstUnit.name : "cm";
        return `1 ${unit}`;
    }

    if (attribute.value_type === "number") {
        return "1";
    }

    if (attribute.value_type === "list" && (attribute.values || []).length > 0) {
        return attribute.values[0].name;
    }

    if (attribute.value_type === "boolean") {
        return "No";
    }

    const fallback = product.productType || product.vendor || "No aplica";
    return String(fallback).slice(0, 120);
}

async function buildRequiredAttributes(categoryId, product) {
    const requiredAttributes = await getRequiredAttributesMetadata(categoryId);
    const defaultsMap = new Map(requiredAttributes.map((attribute) => [
        attribute.id,
        {
            id: attribute.id,
            value_name: getDefaultAttributeValue(attribute, product)
        }
    ]));

    const templates = getTemplateAttributesForCategory(categoryId, product);
    for (const templateAttribute of templates) {
        const valueName = String(templateAttribute.value_name || "").trim();
        if (valueName) {
            defaultsMap.set(templateAttribute.id, {
                id: templateAttribute.id,
                value_name: valueName
            });
        }
    }

    return Array.from(defaultsMap.values());
}

async function refreshAccessToken() {
    const response = await apiClient.post("/oauth/token", {
        grant_type: "refresh_token",
        client_id: config.meli.appId,
        client_secret: config.meli.clientSecret,
        refresh_token: refreshToken,
        redirect_uri: config.meli.redirectUri
    });

    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;

    logger.warn("Mercado Libre access token refreshed. Update .env with new tokens if you restart the service.");
}

async function authorizedRequest(requestFn, options = {}) {
    const {
        hasRetried401 = false,
        retry429 = 0
    } = options;

    try {
        return await requestFn();
    } catch (error) {
        const status = error.response ? error.response.status : null;
        if (status === 401 && !hasRetried401) {
            await refreshAccessToken();
            return authorizedRequest(requestFn, {
                hasRetried401: true,
                retry429
            });
        }

        if (status === 429 && retry429 < 4) {
            const waitMs = (retry429 + 1) * 2000;
            logger.warn("Rate limit hit on Mercado Libre API. Retrying request.", {
                retry: retry429 + 1,
                waitMs
            });
            await sleep(waitMs);

            return authorizedRequest(requestFn, {
                hasRetried401,
                retry429: retry429 + 1
            });
        }

        throw error;
    }
}

function authHeaders() {
    return {
        Authorization: `Bearer ${accessToken}`
    };
}

async function resolveUserId() {
    if (userId) {
        return userId;
    }

    const response = await authorizedRequest(() => apiClient.get("/users/me", { headers: authHeaders() }));
    userId = String(response.data.id);
    return userId;
}

async function searchItemBySku(sku) {
    const sellerId = await resolveUserId();
    const response = await authorizedRequest(() =>
        apiClient.get(`/users/${sellerId}/items/search`, {
            headers: authHeaders(),
            params: {
                seller_sku: sku,
                limit: 1
            }
        })
    );

    const first = (response.data.results || [])[0];
    return first || null;
}

async function getItem(itemId) {
    const response = await authorizedRequest(() =>
        apiClient.get(`/items/${itemId}`, {
            headers: authHeaders()
        })
    );

    return response.data;
}

function shouldRecreateListing(item) {
    const status = String(item.status || "").toLowerCase();
    const subStatus = Array.isArray(item.sub_status)
        ? item.sub_status.map((value) => String(value).toLowerCase())
        : [];

    if (status === "closed" || status === "inactive") {
        return true;
    }

    if (status === "under_review" && subStatus.includes("forbidden")) {
        return true;
    }

    return false;
}

function isNonApprovedListing(item) {
    const status = String(item.status || "").toLowerCase();
    const subStatus = Array.isArray(item.sub_status)
        ? item.sub_status.map((value) => String(value).toLowerCase())
        : [];

    if (status === "under_review") {
        return true;
    }

    if (status === "inactive" && subStatus.includes("not_yet_active")) {
        return true;
    }

    if (status === "inactive" && subStatus.includes("waiting_for_approval")) {
        return true;
    }

    return false;
}

async function closeItem(itemId) {
    try {
        await authorizedRequest(() =>
            apiClient.put(`/items/${itemId}`, {
                status: "closed"
            }, {
                headers: authHeaders()
            })
        );
        return true;
    } catch (error) {
        const status = error.response ? error.response.status : null;
        if (status === 400 || status === 404) {
            return false;
        }
        throw error;
    }
}

async function cleanupNonApprovedMappedItems(mappingsBySku) {
    const entries = Object.entries(mappingsBySku || {});
    let reviewed = 0;
    let closed = 0;
    let failed = 0;
    const closedItemIds = [];

    for (const [sku, mapping] of entries) {
        if (!mapping || !mapping.itemId) {
            continue;
        }

        reviewed += 1;
        try {
            const item = await getItem(mapping.itemId);
            if (!isNonApprovedListing(item)) {
                continue;
            }

            const didClose = await closeItem(mapping.itemId);
            if (didClose) {
                closed += 1;
                closedItemIds.push(String(mapping.itemId));
                logger.warn("Closed non-approved Mercado Libre listing", {
                    sku,
                    itemId: mapping.itemId,
                    status: item.status,
                    sub_status: item.sub_status || []
                });
            }
        } catch (error) {
            failed += 1;
            const details = error.response && error.response.data ? error.response.data : { message: error.message };
            logger.error("Failed cleaning non-approved Mercado Libre listing", {
                sku,
                itemId: mapping.itemId,
                details
            });
        }
    }

    return {
        reviewed,
        closed,
        failed,
        closedItemIds
    };
}

async function setItemQuantity(itemId, quantity) {
    const safeQuantity = Math.max(0, Math.floor(Number(quantity)));
    await authorizedRequest(() =>
        apiClient.put(`/items/${itemId}`, {
            available_quantity: safeQuantity
        }, {
            headers: authHeaders()
        })
    );
}

async function resolveUpdatableItemId(itemId) {
    if (!itemId) {
        return null;
    }

    const item = await getItem(itemId);
    if (shouldRecreateListing(item)) {
        logger.warn("Existing listing is blocked and will be recreated.", {
            itemId,
            status: item.status,
            sub_status: item.sub_status || []
        });
        return null;
    }

    return itemId;
}

async function discoverCategory(product) {
    const mappedCategoryId = resolveCategoryFromRules(product);
    if (mappedCategoryId) {
        return mappedCategoryId;
    }

    if (config.meli.defaultCategoryId) {
        return config.meli.defaultCategoryId;
    }

    const response = await apiClient.get(`/sites/${config.meli.siteId}/domain_discovery/search`, {
        params: {
            q: product.title,
            limit: 1
        }
    });

    const first = (response.data || [])[0];
    if (!first || !first.category_id) {
        if (config.meli.defaultCategoryId) {
            return config.meli.defaultCategoryId;
        }

        throw new Error(`No category could be discovered for SKU ${product.sku}`);
    }

    return first.category_id;
}

function buildPictures(product) {
    const pictureSources = (product.images || []).slice(0, 10);

    if (pictureSources.length === 0 && config.meli.defaultImageUrl) {
        pictureSources.push(config.meli.defaultImageUrl);
    }

    return pictureSources.map((url) => ({ source: url }));
}

async function createItem(product) {
    const categoryId = await discoverCategory(product);

    const buildBasePayload = async (targetCategoryId) => {
        const attributes = await buildRequiredAttributes(targetCategoryId, product);

        return {
            family_name: buildFamilyName(product),
            category_id: targetCategoryId,
            price: computePrice(product.price),
            currency_id: config.sync.currencyId,
            available_quantity: resolveAvailableQuantity(product),
            buying_mode: "buy_it_now",
            listing_type_id: config.meli.listingTypeId,
            condition: "new",
            seller_custom_field: product.sku,
            sale_terms: buildSaleTerms(),
            pictures: buildPictures(product),
            attributes
        };
    };

    const createWithCategory = async (targetCategoryId) => {
        const basePayload = await buildBasePayload(targetCategoryId);
        if (!basePayload.pictures || basePayload.pictures.length === 0) {
            throw new Error(
                `SKU ${product.sku} has no images. Add product images in Shopify or configure MELI_DEFAULT_IMAGE_URL.`
            );
        }

        const payloadWithTitle = {
            ...basePayload,
            title: buildTitle(product)
        };

        try {
            return await postItem(payloadWithTitle);
        } catch (error) {
            if (!isTitleInvalidForCreate(error)) {
                throw error;
            }

            logger.warn("Title is invalid for this publication type. Retrying create without title.", {
                sku: product.sku,
                categoryId: targetCategoryId
            });

            return postItem(basePayload);
        }
    };

    let response;

    try {
        response = await createWithCategory(categoryId);
    } catch (error) {
        const shouldRetryWithDefaultCategory = canRetryCreateWithDefaultCategory(error, categoryId);

        if (!shouldRetryWithDefaultCategory) {
            if (isAttributesRequired(error) && !config.meli.defaultCategoryId) {
                throw new Error(
                    `Category ${categoryId} requires required attributes for SKU ${product.sku}. Configure MELI_DEFAULT_CATEGORY_ID to a compatible category.`
                );
            }

            throw error;
        }

        logger.warn("Create failed in discovered category. Retrying with MELI_DEFAULT_CATEGORY_ID.", {
            sku: product.sku,
            discoveredCategoryId: categoryId,
            fallbackCategoryId: config.meli.defaultCategoryId
        });

        response = await createWithCategory(config.meli.defaultCategoryId);
    }

    const price = computePrice(product.price);

    return {
        itemId: response.data.id,
        price
    };
}

async function updateItem(itemId, product) {
    if (config.sync.autoActivatePaused) {
        const item = await getItem(itemId);
        if (String(item.status || "").toLowerCase() === "paused") {
            logger.warn("Paused listing detected. Attempting to reactivate.", {
                itemId,
                sku: product.sku
            });

            await authorizedRequest(() =>
                apiClient.put(`/items/${itemId}`, {
                    status: "active"
                }, {
                    headers: authHeaders()
                })
            );
        }
    }

    const basePayload = {
        price: computePrice(product.price),
        available_quantity: resolveAvailableQuantity(product)
    };

    const payload = {
        ...basePayload
    };

    if (config.sync.updateTitle) {
        payload.title = buildTitle(product);
    }

    try {
        await authorizedRequest(() =>
            apiClient.put(`/items/${itemId}`, payload, {
                headers: authHeaders()
            })
        );
    } catch (error) {
        if (isItemNotModifiable(error)) {
            logger.warn("Item update skipped because listing is not modifiable right now.", {
                itemId,
                sku: product.sku
            });

            return {
                itemId,
                price: basePayload.price,
                skipped: true
            };
        }

        if (config.sync.updateTitle && isTitleBlockedByFamilyName(error)) {
            logger.warn("Title update blocked by family_name. Retrying update without title.", {
                itemId,
                sku: product.sku
            });

            await authorizedRequest(() =>
                apiClient.put(`/items/${itemId}`, basePayload, {
                    headers: authHeaders()
                })
            );
        } else {
            throw error;
        }
    }

    return {
        itemId,
        price: basePayload.price
    };
}

module.exports = {
    cleanupNonApprovedMappedItems,
    computePrice,
    createItem,
    updateItem,
    setItemQuantity,
    searchItemBySku,
    resolveUpdatableItemId
};
