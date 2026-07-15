import { useEffect, useRef, useState } from "react";
import { getVodStreamerAvatar } from "../lib/desktop";
import type { VodLibraryStreamer } from "../types";

interface VodStreamerAvatarProps {
  streamer: VodLibraryStreamer;
  size?: "picker" | "card";
}

function monogram(value: string): string {
  return Array.from(value.trim())[0]?.toLocaleUpperCase("zh-TW") ?? "推";
}

export function VodStreamerAvatar({
  streamer,
  size = "card",
}: VodStreamerAvatarProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSource(null);
    setFailed(false);
    if (!streamer.avatarUrl) return;

    let disposed = false;
    let observer: IntersectionObserver | null = null;
    const load = () => {
      void getVodStreamerAvatar(streamer.slug, streamer.avatarUrl)
        .then((avatar) => {
          if (!disposed) setSource(avatar);
        })
        .catch(() => {
          if (!disposed) setFailed(true);
        });
    };

    const target = containerRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      load();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect();
          load();
        },
        { rootMargin: "120px" },
      );
      observer.observe(target);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [streamer.avatarUrl, streamer.slug]);

  return (
    <span
      ref={containerRef}
      className={`vod-streamer-avatar ${size}`}
      aria-hidden="true"
    >
      {source && !failed ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{monogram(streamer.displayName)}</span>
      )}
    </span>
  );
}
