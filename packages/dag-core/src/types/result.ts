export type TResult<TValue, TError> =
    | {
        ok: true;
        value: TValue;
    }
    | {
        ok: false;
        error: TError;
    };
