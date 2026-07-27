import fs from "node:fs";
import FormData from "form-data";
import fetch from "node-fetch";

function isAlphabet(str: string) {
	return /[a-zA-Z]/g.test(str);
}

export function validateCarLicense(licensePlate: string) {
	const weightedValue = [9, 4, 5, 4, 3, 2];
	const dict: Record<string, number> = {
		A: 1,
		B: 2,
		C: 3,
		D: 4,
		E: 5,
		F: 6,
		G: 7,
		H: 8,
		I: 9,
		J: 10,
		K: 11,
		L: 12,
		M: 13,
		N: 14,
		O: 15,
		P: 16,
		Q: 17,
		R: 18,
		S: 19,
		T: 20,
		U: 21,
		V: 22,
		W: 23,
		X: 24,
		Y: 25,
		Z: 26,
	};

	const icdDict: Record<number, string> = {
		0: "A",
		1: "B",
		2: "C",
		3: "D",
		4: "E",
		5: "G",
		6: "H",
		7: "J",
		8: "K",
		9: "L",
		10: "M",
		11: "P",
		12: "R",
		13: "S",
		14: "T",
		15: "U",
		16: "X",
		17: "Y",
		18: "Z",
	};

	const plate = licensePlate.trim().toUpperCase();
	const lastCharacter = plate.substring(plate.length - 1, plate.length);
	if (isAlphabet(lastCharacter)) {
		return plate;
	}

	let sum = 0;
	let i = 0;
	let hasFinishAlphabet = false;
	let hasProcessedFirstAlphabet = false;
	const numberOfIntegers = plate.replace(/[^0-9]/g, "").length;
	let numberOfAlphabet = plate.replace(/[^A-Z]/g, "").length;
	for (const character of plate.split("")) {
		if (i === 0 && ["S", "G"].includes(character) && numberOfAlphabet === 3) {
			numberOfAlphabet -= 1;
			continue;
		}

		if (numberOfAlphabet === 1 && !hasProcessedFirstAlphabet) {
			i += 1;
			hasProcessedFirstAlphabet = true;
		}

		if (isAlphabet(character)) {
			sum += dict[character] * weightedValue[i];
			i += 1;
			continue;
		} else {
			if (!hasFinishAlphabet) {
				const insertedZeroes = 4 - numberOfIntegers;
				i += insertedZeroes;
				hasFinishAlphabet = true;
			}

			sum += parseInt(character, 10) * weightedValue[i];
		}

		i += 1;
	}

	const ccd = sum % 19;
	const icd = ccd === 0 ? 0 : 19 - ccd;
	return `${plate}${icdDict[icd]}`;
}

interface PlateRecognizerResponse {
	results: Array<{
		plate: string;
	}>;
}

export async function getPlateRecognition(
	filePath: string,
): Promise<string | undefined> {
	const body = new FormData();
	const file = fs.readFileSync(filePath, { encoding: "base64" });
	body.append("upload", file);
	body.append("regions", "sg");
	const response = await fetch(
		"https://api.platerecognizer.com/v1/plate-reader/",
		{
			method: "POST",
			headers: {
				Authorization: `Token ${process.env.PLATERECOGNIZER_KEY!}`,
			},
			body,
		},
	);

	const json = (await response.json()) as PlateRecognizerResponse;
	return json?.results?.[0]?.plate;
}
