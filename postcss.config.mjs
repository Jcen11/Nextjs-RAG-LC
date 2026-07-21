// Tailwind v4 的 PostCSS 配置
// v4 不再需要 tailwind.config.js，配置都在 CSS 里用 @import "tailwindcss" + @theme
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
