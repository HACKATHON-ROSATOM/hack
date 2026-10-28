import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', {
  state: () => ({
    role: 'director',
  }),
  actions: {
    setRole(role) {
      this.role = role
    },
  },
})
