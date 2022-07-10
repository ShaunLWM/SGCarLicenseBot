import fs from "fs";

export const TEMPORARY_CACHE_DIRECTORY = './cache';

export async function wait(ms = 1000) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function createDirectory(path: string) {
    return `${TEMPORARY_CACHE_DIRECTORY}/${path}`;
}

export function cleanText(str: string) {
    return str.replace(/\s/gm, "").replace(/\n/gm, "").replace(/\r/gm, "");
}

export function cleanupCache(path: string) {
    if (fs.existsSync(path)) {
        fs.rmSync(path);
    }
}