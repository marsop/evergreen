import fs from "node:fs";

const config = JSON.parse(process.env.FIREBASE_WEB_CONFIG ?? "{}");
const allowed = new Set(["apiKey", "authDomain", "projectId", "appId", "messagingSenderId", "measurementId", "storageBucket"]);
if (Object.keys(config).some(key => !allowed.has(key))) throw new Error("Only public Firebase web configuration fields are allowed.");
for (const key of ["apiKey", "authDomain", "projectId", "appId"]) {
    if (typeof config[key] !== "string" || !config[key].trim() || config[key].includes("YOUR_"))
        throw new Error(`Set the FIREBASE_WEB_CONFIG repository variable: missing/invalid ${key}.`);
}
fs.writeFileSync(new URL("../wwwroot/firebase-config.json", import.meta.url), JSON.stringify(config, null, 2) + "\n");
