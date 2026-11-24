// Copyright (c) 2026 Sub Rosa contributors
import type { AnchorHTMLAttributes, ReactNode } from "react";

export const SAFE_EXTERNAL_REL = "noopener noreferrer";

type ExternalLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "target" | "rel" | "href" | "children"
> & {
  href: string;
  children: ReactNode;
};

export function ExternalLink({ href, children, ...props }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel={SAFE_EXTERNAL_REL} {...props}>
      {children}
    </a>
  );
}
