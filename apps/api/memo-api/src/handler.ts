import type { Clock, IdGenerator, MemoRepository } from "@memo/core";
import type { HttpRequest, HttpResponse } from "./http";

export type HandlerDeps = {
  repository: MemoRepository;
  clock: Clock;
  idGenerator: IdGenerator;
  log: (line: string) => void;
  timer: () => number;
};

export function createHandler(_deps: HandlerDeps): (request: HttpRequest) => Promise<HttpResponse> {
  return async () => {
    throw new Error("not implemented");
  };
}
