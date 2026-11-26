const BLANK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
/** WebKit draws a broken-image glyph over the card; a blank image keeps the card's frame and background. */
export const hideBroken = (e: Event) => ((e.currentTarget as HTMLImageElement).src = BLANK);

/**
 * The card-sized poster on a 1x screen, the full one on a denser screen. WebKitGTK shrinks a full
 * poster to a card without mipmaps, which shows as grain.
 */
export const cardSrcset = (small: string | undefined, full: string) =>
	small ? `${small} 1x, ${full} 2x` : undefined;

/** When the card-sized copy fails (offline, a download keeps only the full poster), the full one is tried before `then`. */
export const orFull = (then: (e: Event) => void) => (e: Event) => {
	const img = e.currentTarget as HTMLImageElement;
	if (img.srcset) img.removeAttribute("srcset");
	else then(e);
};

/** Titles without a backdrop fall back to their poster; without either, the image hides. */
export const orPoster = (poster: string, position?: string, small?: string) => (e: Event) => {
	const img = e.currentTarget as HTMLImageElement;
	if (img.src === poster) return orFull(hideBroken)(e);
	img.src = poster;
	img.srcset = cardSrcset(small, poster) ?? "";
	img.style.objectPosition = position ?? "";
};
