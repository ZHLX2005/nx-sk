// AppError + code → HTTP 状态 / CLI 退出码的唯一映射。
// 上层拿 err.code 分支，**不要对错误文本做字符串匹配**。

export const CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BLOCKED: 'BLOCKED',
  EXTERNAL: 'EXTERNAL',
  INTERNAL: 'INTERNAL',
};

export class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code || CODES.INTERNAL;
    if (details !== undefined) this.details = details;
  }
}

export const badInput = (msg, details) => new AppError(CODES.INVALID_INPUT, msg, details);
export const notFound = (msg, details) => new AppError(CODES.NOT_FOUND, msg, details);
export const conflict = (msg, details) => new AppError(CODES.CONFLICT, msg, details);
export const blocked = (msg, details) => new AppError(CODES.BLOCKED, msg, details);
export const external = (msg, details) => new AppError(CODES.EXTERNAL, msg, details);
export const internal = (msg, details) => new AppError(CODES.INTERNAL, msg, details);

const HTTP = {
  [CODES.INVALID_INPUT]: 400,
  [CODES.NOT_FOUND]: 404,
  [CODES.CONFLICT]: 409,
  [CODES.BLOCKED]: 409,
  [CODES.EXTERNAL]: 502,
  [CODES.INTERNAL]: 500,
};

/** CONFLICT 与 BLOCKED 都映射 409：前者是「你选哪边」，后者是「你先去满足前置条件」。 */
export function httpStatusOf(code) {
  return HTTP[code] || 500;
}

/** 失败一律退出码 1。冲突是**业务结果**不是失败——那种情况根本不会走到这里。 */
export function exitCodeOf(_code) {
  return 1;
}

/** 把任意 throw 出来的东西归一成 { code, message }，供 CLI / API 统一渲染。 */
export function toErrorShape(err) {
  if (err instanceof AppError) return { code: err.code, message: err.message, details: err.details };
  return { code: CODES.INTERNAL, message: err && err.message ? err.message : String(err) };
}
