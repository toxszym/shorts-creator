export const fold = (text: string) =>
  text.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Tekst sprowadzony do liter i cyfr, do porównywania cytatów bez względu na interpunkcję. */
export const normalize = (text: string) => fold(text).replace(/[^a-z0-9]+/g, " ").trim();

export const tokens = (text: string) => normalize(text).split(" ").filter((t) => t.length >= 3);

/**
 * Polska fleksja zmienia końcówki, więc dwa słowa uznajemy za to samo,
 * gdy mają wspólny początek i różnią się najwyżej dwuliterową końcówką.
 */
export function sameWord(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const shorter = Math.min(a.length, b.length);
  let common = 0;
  while (common < shorter && a[common] === b[common]) common++;
  return common >= Math.max(4, shorter - 2);
}
