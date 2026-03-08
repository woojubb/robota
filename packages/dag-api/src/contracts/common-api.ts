/** Successful API response wrapper with status code and typed data. */
export interface IApiSuccess<TData> {
    ok: true;
    status: number;
    data: TData;
}

/** Failed API response wrapper with status code and typed error array. */
export interface IApiFailure<TError> {
    ok: false;
    status: number;
    errors: TError[];
}

/** Discriminated union of success or failure API responses. */
export type TApiResponse<TData, TError> = IApiSuccess<TData> | IApiFailure<TError>;
