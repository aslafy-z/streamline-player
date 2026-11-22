// node dev/form-factor-check.ts
import { strictEqual as eq } from "node:assert";
import { isPhoneSize, phoneSizeByWidth } from "../src/lib/platform/form-factor.ts";

eq(isPhoneSize(390, 844), true);
eq(isPhoneSize(844, 390), true);
eq(isPhoneSize(375, 667), true);
eq(isPhoneSize(599, 900), true);
eq(isPhoneSize(600, 900), false);
eq(isPhoneSize(834, 1194), false);
eq(isPhoneSize(1194, 834), false);
eq(isPhoneSize(1280, 800), false);
eq(isPhoneSize(500, 1200), true);

// The keyboard on a landscape tablet: the height alone shrinks below a phone's, the layout stays.
let phone = phoneSizeByWidth();
eq(phone(1280, 800), false);
eq(phone(1280, 450), false);
eq(phone(1280, 800), false);
// A rotation is measured afresh, and the width it left keeps its height.
eq(phone(800, 1280), false);
eq(phone(1280, 450), false);
// A phone stays a phone, keyboard or not.
phone = phoneSizeByWidth();
eq(phone(390, 844), true);
eq(phone(390, 500), true);
eq(phone(844, 390), true);
// A side-by-side split is a new width, measured as it is.
phone = phoneSizeByWidth();
eq(phone(1280, 800), false);
eq(phone(400, 800), true);

console.log("form-factor-check: ok");
