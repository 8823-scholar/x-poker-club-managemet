/**
 * Notion API の型安全なプロパティビルダー
 * dataSources API と pages API でプロパティを構築するためのヘルパー関数を提供
 */
import type {
  DataSourcePropertyValue,
  CreatePagePropertyValue,
  UpdatePagePropertyValue,
} from '../types/notion.js';

/**
 * DataSource (データベース) プロパティ用ファクトリー
 * dataSources.update() のpropertiesパラメータを構築するためのヘルパー
 */
export const dataSourceProps = {
  /**
   * プロパティ名のリネーム
   */
  rename: (name: string): DataSourcePropertyValue => ({
    name,
  }),

  /**
   * 単方向リレーションプロパティ
   */
  singleRelation: (databaseId: string): DataSourcePropertyValue => ({
    relation: {
      data_source_id: databaseId,
      single_property: {},
    },
  }),

  /**
   * 双方向リレーションプロパティ
   */
  dualRelation: (
    databaseId: string,
    syncedPropertyName: string
  ): DataSourcePropertyValue => ({
    relation: {
      data_source_id: databaseId,
      dual_property: {
        synced_property_name: syncedPropertyName,
      },
    },
  }),

  /**
   * ロールアッププロパティ
   */
  rollup: (
    relationPropertyName: string,
    rollupPropertyName: string,
    fn: 'sum' | 'count' | 'average' | 'min' | 'max' | 'show_original' | 'count_values' | 'count_per_group' | 'percent_per_group' | 'unique' | 'show_unique' | 'date_range' | 'earliest_date' | 'latest_date' | 'checked' | 'unchecked' | 'percent_checked' | 'percent_unchecked' | 'median' | 'range'
  ): DataSourcePropertyValue => ({
    rollup: {
      function: fn,
      relation_property_name: relationPropertyName,
      rollup_property_name: rollupPropertyName,
    },
  }),
};

/**
 * Page プロパティ用ファクトリー
 * pages.create() / pages.update() のpropertiesパラメータを構築するためのヘルパー
 */
export const pageProps = {
  /**
   * タイトルプロパティ
   */
  title: (content: string): CreatePagePropertyValue => ({
    title: [{ text: { content } }],
  }),

  /**
   * リッチテキストプロパティ
   */
  richText: (content: string): CreatePagePropertyValue => ({
    rich_text: [{ text: { content } }],
  }),

  /**
   * 数値プロパティ
   */
  number: (value: number | null): CreatePagePropertyValue => ({
    number: value,
  }),

  /**
   * 日付プロパティ
   */
  date: (start: string, end?: string): CreatePagePropertyValue => ({
    date: { start, end: end ?? null },
  }),

  /**
   * リレーションプロパティ
   */
  relation: (ids: string[]): CreatePagePropertyValue => ({
    relation: ids.map((id) => ({ id })),
  }),

  /**
   * チェックボックスプロパティ
   */
  checkbox: (checked: boolean): CreatePagePropertyValue => ({
    checkbox: checked,
  }),
};

/**
 * DataSource用のプロパティマップを構築
 * 型推論を維持しながらRecord<string, DataSourcePropertyValue>を返す
 */
export function buildDataSourceProperties<K extends string>(
  properties: { [key in K]: DataSourcePropertyValue }
): Record<string, DataSourcePropertyValue> {
  return properties;
}

/**
 * Page作成用のプロパティマップを構築
 * 型推論を維持しながらRecord<string, CreatePagePropertyValue>を返す
 */
export function buildCreatePageProperties<K extends string>(
  properties: { [key in K]: CreatePagePropertyValue }
): Record<string, CreatePagePropertyValue> {
  return properties;
}

/**
 * Page更新用のプロパティマップを構築
 * 型推論を維持しながらRecord<string, UpdatePagePropertyValue>を返す
 */
export function buildUpdatePageProperties<K extends string>(
  properties: { [key in K]: UpdatePagePropertyValue }
): Record<string, UpdatePagePropertyValue> {
  return properties;
}
