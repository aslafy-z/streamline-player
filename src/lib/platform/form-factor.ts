export const PHONE_MAX_SHORT_SIDE = 600;

export const isPhoneSize = (width: number, height: number) =>
	Math.min(width, height) < PHONE_MAX_SHORT_SIDE;

/**
 * isPhoneSize over the tallest height the page has had at each width. The height alone shrinks
 * for the on-screen keyboard and the browser's bars, and neither is a reason to change layouts:
 * on a landscape tablet the keyboard leaves less than a phone's short side, and the phone layout
 * would take the field being typed into away, and the keyboard with it. A new width (a rotation,
 * a side-by-side split) is measured afresh.
 */
export function phoneSizeByWidth(): (width: number, height: number) => boolean {
	const tallest = new Map<number, number>();
	return (width, height) => {
		const h = Math.max(tallest.get(width) ?? 0, height);
		tallest.set(width, h);
		return isPhoneSize(width, h);
	};
}
