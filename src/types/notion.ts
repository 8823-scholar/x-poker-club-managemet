/**
 * Notion SDK 5.x の型定義ヘルパー
 * dataSources API と pages API で使用するプロパティ値の型を提供
 */
import type {
  UpdateDataSourceParameters,
  CreatePageParameters,
  UpdatePageParameters,
  DataSourceObjectResponse,
} from '@notionhq/client/build/src/api-endpoints.js';

/**
 * DataSource更新時のプロパティ値の型
 * UpdateDataSourceParameters['properties'] のRecord値
 */
export type DataSourcePropertyValue = NonNullable<
  UpdateDataSourceParameters['properties']
>[string];

/**
 * Page作成時のプロパティ値の型
 * CreatePageParameters['properties'] のRecord値
 */
export type CreatePagePropertyValue = NonNullable<
  CreatePageParameters['properties']
>[string];

/**
 * Page更新時のプロパティ値の型
 * UpdatePageParameters['properties'] のRecord値
 */
export type UpdatePagePropertyValue = NonNullable<
  UpdatePageParameters['properties']
>[string];

/**
 * DataSourceのプロパティスキーマ型
 * DataSourceObjectResponse['properties'] のRecord値
 */
export type DataSourcePropertySchema = DataSourceObjectResponse['properties'][string];

/**
 * DataSource更新パラメータ全体の型をre-export
 */
export type { UpdateDataSourceParameters };

/**
 * Page作成パラメータ全体の型をre-export
 */
export type { CreatePageParameters };

/**
 * Page更新パラメータ全体の型をre-export
 */
export type { UpdatePageParameters };
