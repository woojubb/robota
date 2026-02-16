export interface IApiSuccess<TData> {
    ok: true;
    status: number;
    data: TData;
}

export interface IApiFailure<TError> {
    ok: false;
    status: number;
    errors: TError[];
}

export type TApiResponse<TData, TError> = IApiSuccess<TData> | IApiFailure<TError>;
