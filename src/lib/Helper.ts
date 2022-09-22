import fs from "fs";

export const SERPAPI_IMAGE_PREFIX = 'https://serpapi.com/searches/';

export const TEMPORARY_CACHE_DIRECTORY = './.cache';

export async function wait(ms = 1000) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function createDirectory(path: string) {
    return `${TEMPORARY_CACHE_DIRECTORY}/${path}`;
}

export function cleanText(str: string) {
    return str.replace(/\s\s+/g, ' ').trim();
}

export function cleanupCache(path: string) {
    if (fs.existsSync(path)) {
        fs.rmSync(path);
    }
}

export const CAR_BRANDS = {
    "alfa romeo": "alfa romeo",
    "alfa": "alfa romeo",
    "alpine": "alpine",
    "aston martin": "aston martin",
    "aston": "aston martin",
    "audi": "audi",
    "bentley": "bentley",
    "bmw": "bmw",
    "byd": "byd",
    "chevrolet": "chevrolet",
    "citroen": "citroen",
    "cupra": "cupra",
    "dfsk": "dfsk",
    "ds": "ds",
    "ferrari": "ferrari",
    "fiat": "fiat",
    "ford": "ford",
    "foton": "foton",
    "golden dragon": "golden dragon",
    "hino": "hino",
    "honda": "honda",
    "hyundai": "hyundai",
    "isuzu": "isuzu",
    "jaguar": "jaguar",
    "jeep": "jeep",
    "kia": "kia",
    "lamborghini": "lamborghini",
    "lambo": "lamborghini",
    "land rover": "land rover",
    "lexus": "lexus",
    "lotus": "lotus",
    "maserati": "maserati",
    "maxus": "maxus",
    "mazda": "mazda",
    "mclaren": "mclaren",
    "mercedes-benz": "mercedes-benz",
    "mercedes": "mercedes-benz",
    "mercs": "mercedes-benz",
    "mg": "mg",
    "mini": "mini",
    "mitsubishi": "mitsubishi",
    "m": "mitsubishi",
    "mitsuoka": "mitsuoka",
    "morgan": "morgan",
    "nissan": "nissan",
    "opel": "opel",
    "pagani": "pagani",
    "perodua": "perodua",
    "peugeot": "peugeot",
    "polestar": "polestar",
    "porsche": "porsche",
    "renault": "renault",
    "rolls-royce": "rolls-royce",
    "rr": "rolls-royce",
    "seat": "seat",
    "skoda": "skoda",
    "smart": "smart",
    "sokon": "sokon",
    "ssangyong": "ssangyong",
    "sy": "ssangyong",
    "subaru": "subaru",
    "suzuki": "suzuki",
    "tesla": "tesla",
    "toyota": "toyota",
    "volkswagen": "volkswagen",
    "vw": "volkswagen",
    "volvo": "volvo"
};
