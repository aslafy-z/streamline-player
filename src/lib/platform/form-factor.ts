export const PHONE_MAX_SHORT_SIDE = 600;

export const isPhoneSize = (width: number, height: number) =>
	Math.min(width, height) < PHONE_MAX_SHORT_SIDE;
