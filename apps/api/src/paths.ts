import path from "node:path";

/** Katalog projektu: assety, dane i wyniki leżą poza aplikacją API. */
export const ROOT = process.env.KRONIKA_ROOT ?? path.resolve(__dirname, "../../..");
