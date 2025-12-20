import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          500: "#2563EB",
          600: "#1D4ED8"
        }
      }
    }
  },
  plugins: []
};

export default config;

