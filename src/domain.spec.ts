import { describe, expect, it } from "vitest";
import { contentTypeOf, creatorOf, FILE_NAME, rangeOf } from "./domain.ts";

describe("rangeOf", () => {
  it("reads one span: from-to, from onwards, and the last n bytes", () => {
    expect(rangeOf("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(rangeOf("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(rangeOf("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("ends a span that runs past the file at its last byte, and takes a suffix longer than the file as all of it", () => {
    expect(rangeOf("bytes=500-5000", 1000)).toEqual({ start: 500, end: 999 });
    expect(rangeOf("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("answers the whole file for no header, a malformed one, or several spans", () => {
    for (const header of [undefined, "", "bytes=", "bytes=-", "items=0-1", "bytes=5-2", "bytes=0-1,4-5"]) expect(rangeOf(header, 1000), header).toBeNull();
  });

  it("is unsatisfiable when it starts at or past the end", () => {
    expect(rangeOf("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(rangeOf("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});

describe("contentTypeOf", () => {
  it("takes the request's type, without its parameters", () => {
    expect(contentTypeOf("a.bin", "Video/MP4; codecs=avc1")).toBe("video/mp4");
  });

  it("takes the name's when the request's says nothing", () => {
    for (const given of [undefined, null, "", "application/octet-stream", "application/x-www-form-urlencoded", "not a type"]) expect(contentTypeOf("clip.MP4", given)).toBe("video/mp4");
    expect(contentTypeOf("tone.mp3", undefined)).toBe("audio/mpeg");
    expect(contentTypeOf("shot.png", undefined)).toBe("image/png");
  });

  it("falls back to application/octet-stream", () => {
    expect(contentTypeOf("data.xyz", undefined)).toBe("application/octet-stream");
    expect(contentTypeOf("README", undefined)).toBe("application/octet-stream");
  });
});

describe("names", () => {
  it("takes a file name, never a path or a dot entry", () => {
    for (const name of ["clip.mp4", "Screen Shot 1.png", "ünïcode.mp3", ".hidden"]) expect(FILE_NAME.test(name), name).toBe(true);
    for (const name of ["a/b.png", "..", ".", "a\\b", "bad\nname"]) expect(FILE_NAME.test(name), name).toBe(false);
  });

  it("credits a well-formed x-actor, else the caller", () => {
    expect(creatorOf("implementer-a1b2", "agent")).toBe("implementer-a1b2");
    expect(creatorOf(undefined, "agent")).toBe("agent");
    expect(creatorOf("has space", "agent")).toBe("agent");
  });
});
