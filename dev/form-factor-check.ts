// node dev/form-factor-check.ts
import { strictEqual as eq } from "node:assert";
import { isPhoneSize } from "../src/lib/platform/form-factor.ts";

eq(isPhoneSize(390, 844), true);
eq(isPhoneSize(844, 390), true);
eq(isPhoneSize(375, 667), true);
eq(isPhoneSize(599, 900), true);
eq(isPhoneSize(600, 900), false);
eq(isPhoneSize(834, 1194), false);
eq(isPhoneSize(1194, 834), false);
eq(isPhoneSize(1280, 800), false);
eq(isPhoneSize(500, 1200), true);

console.log("form-factor-check: ok");
