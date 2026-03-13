const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

function required(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return value.trim();
}

function optional(name, fallback = "") {
    const value = process.env[name];
    return value && value.trim() ? value.trim() : fallback;
}

function getAuthBaseUrl(siteId, explicit) {
    if (explicit) {
        return explicit;
    }

    const map = {
        MLA: "https://auth.mercadolibre.com.ar",
        MLM: "https://auth.mercadolibre.com.mx",
        MCO: "https://auth.mercadolibre.com.co",
        MLB: "https://auth.mercadolivre.com.br"
    };

    return map[siteId] || "https://auth.mercadolibre.com";
}

async function exchangeCodeForTokens({ appId, clientSecret, redirectUri, code }) {
    const response = await axios.post("https://api.mercadolibre.com/oauth/token", {
        grant_type: "authorization_code",
        client_id: appId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
    });

    return response.data;
}

async function refreshTokens({ appId, clientSecret, refreshToken, redirectUri }) {
    const response = await axios.post("https://api.mercadolibre.com/oauth/token", {
        grant_type: "refresh_token",
        client_id: appId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        redirect_uri: redirectUri
    });

    return response.data;
}

async function getUserId(accessToken) {
    const response = await axios.get("https://api.mercadolibre.com/users/me", {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    return response.data.id;
}

async function main() {
    const siteId = optional("MELI_SITE_ID", "MCO");
    const appId = required("MELI_APP_ID");
    const clientSecret = required("MELI_CLIENT_SECRET");
    const redirectUri = required("MELI_REDIRECT_URI");
    const authBaseUrl = getAuthBaseUrl(siteId, optional("MELI_AUTH_BASE_URL", ""));

    const codeArg = process.argv.find((arg) => arg.startsWith("--code="));
    const refreshMode = process.argv.includes("--refresh");

    if (!codeArg && !refreshMode) {
        const authUrl = `${authBaseUrl}/authorization?response_type=code&client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

        console.log("Open this URL and authorize your seller account:");
        console.log(authUrl);
        console.log("");
        console.log("Then copy the code from the callback URL and run:");
        console.log("npm run ml:token -- --code=YOUR_CODE");
        return;
    }

    let tokenData;

    if (refreshMode) {
        const refreshTokenValue = required("MELI_REFRESH_TOKEN");
        tokenData = await refreshTokens({
            appId,
            clientSecret,
            refreshToken: refreshTokenValue,
            redirectUri
        });
    } else {
        const code = codeArg.split("=")[1];
        tokenData = await exchangeCodeForTokens({
            appId,
            clientSecret,
            redirectUri,
            code
        });
    }

    const userId = await getUserId(tokenData.access_token);

    console.log("Copy these values into your .env file:");
    console.log(`MELI_ACCESS_TOKEN=${tokenData.access_token}`);
    console.log(`MELI_REFRESH_TOKEN=${tokenData.refresh_token}`);
    console.log(`MELI_USER_ID=${userId}`);
}

main().catch((error) => {
    const status = error.response ? error.response.status : "n/a";
    const data = error.response ? error.response.data : error.message;
    console.error("Mercado Libre token flow failed:", status, data);
    process.exit(1);
});
