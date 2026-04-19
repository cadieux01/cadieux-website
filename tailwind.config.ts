import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        heading: ['"Cormorant Garamond"', "serif"],
        body: ['"Jost"', "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
