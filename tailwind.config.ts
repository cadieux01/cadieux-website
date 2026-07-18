import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        heading: ["var(--font-heading)", '"DM Sans"', "sans-serif"],
        body: ["var(--font-body)", '"DM Sans"', "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
