/**
 * 現在の週番号を取得（ISO週番号）
 */
export function getCurrentWeekNumber(): number {
  const now = new Date();
  return getWeekNumber(now);
}

/**
 * 指定した日付の週番号を取得（ISO週番号）
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * 週番号から週の開始日と終了日を取得
 */
export function getWeekDateRange(
  year: number,
  weekNumber: number
): { start: Date; end: Date } {
  const simple = new Date(year, 0, 1 + (weekNumber - 1) * 7);
  const dow = simple.getDay();
  const start = new Date(simple);
  if (dow <= 4) {
    start.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    start.setDate(simple.getDate() + 8 - simple.getDay());
  }
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

/**
 * 日付を YYYY-MM-DD 形式にフォーマット
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * 金額を日本円形式にフォーマット
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
  }).format(amount);
}
