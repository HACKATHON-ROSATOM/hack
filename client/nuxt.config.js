export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],
  ui: { colorMode: false },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    apiBase: '',
  },
  app: {
    head: {
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})

