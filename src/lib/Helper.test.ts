import { validateCarLicense } from "./Helper";

function expect(from: string, to: string) {
  if (from !== to) {
    throw new Error(`Expected ${to} but got ${from}`);
  }
}

// https://www.mycarforum.com/forums/topic/2694644-singapore-license-plate-checksum-digit-calculation/?do=findComment&comment=5611017
expect(validateCarLicense("E75"), "E75H");
expect(validateCarLicense("EL1"), "EL1A");
expect(validateCarLicense("E115"), "E115B");
expect(validateCarLicense("GY55"), "GY55C");
expect(validateCarLicense("GY8822"), "GY8822C");
expect(validateCarLicense("SGA4137"), "SGA4137A");
expect(validateCarLicense("PA9707"), "PA9707R");
expect(validateCarLicense("EA4254"), "EA4254T");
expect(validateCarLicense("SCY79"), "SCY79G");
expect(validateCarLicense("SBS9683"), "SBS9683X");
expect(validateCarLicense("SCW0241"), "SCW0241P");
expect(validateCarLicense("GBA1511"), "GBA1511G");
expect(validateCarLicense("GY9831"), "GY9831U");
expect(validateCarLicense("SGF2306"), "SGF2306R");
expect(validateCarLicense("XD3634"), "XD3634X");
expect(validateCarLicense("SJK6655"), "SJK6655U");
expect(validateCarLicense("SHA9587"), "SHA9587P");
expect(validateCarLicense("SHB1703"), "SHB1703T");
expect(validateCarLicense("SJF5759"), "SJF5759L");
expect(validateCarLicense("SGM6322"), "SGM6322E");
expect(validateCarLicense("GBA1573"), "GBA1573C");

console.log("All tests passed!")
