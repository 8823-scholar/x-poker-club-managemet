import { google, sheets_v4 } from "googleapis";

let sheetsClient: sheets_v4.Sheets | null = null;

/**
 * Google Sheets APIクライアントを取得
 */
export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) {
    return sheetsClient;
  }

  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY が設定されていません");
  }

  const credentials = JSON.parse(
    Buffer.from(serviceAccountKey, "base64").toString("utf-8")
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

/**
 * スプレッドシートIDを取得
 */
export function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID が設定されていません");
  }
  return spreadsheetId;
}

/**
 * シートからデータを取得
 */
export async function getSheetData(
  range: string
): Promise<string[][] | null | undefined> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return response.data.values;
}

/**
 * シートにデータを追加
 */
export async function appendSheetData(
  range: string,
  values: (string | number)[][]
): Promise<sheets_v4.Schema$AppendValuesResponse | undefined> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values,
    },
  });

  return response.data;
}

/**
 * シートのデータを更新
 */
export async function updateSheetData(
  range: string,
  values: (string | number)[][]
): Promise<sheets_v4.Schema$UpdateValuesResponse | undefined> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values,
    },
  });

  return response.data;
}
