/** Discriminated union representing either a successful value or an error. */
export type TResult<TValue, TError> =
    | {
        ok: true;
        value: TValue;
    }
    | {
        ok: false;
        error: TError;
    };
