"use client";

import dynamic from "next/dynamic";

const SplitText = dynamic(() => import("./SplitText"), { ssr: false });

export default SplitText;
