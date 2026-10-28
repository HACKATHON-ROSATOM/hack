<script setup>
definePageMeta({ layout: 'auth' })

const route = useRoute()
const loading = ref(false)

async function retry() {
  if (loading.value) return
  loading.value = true
  try {
    const returnTo = route.query.returnTo
    const target = typeof returnTo === 'string' && returnTo.startsWith('/') &&
      !returnTo.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(returnTo) &&
      returnTo.split(/[?#]/, 1)[0] !== '/session-unavailable'
      ? returnTo
      : '/'
    await navigateTo(target)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-brand/5 px-4 py-10">
    <UCard class="w-full max-w-sm bg-white shadow-sm ring-1 ring-brand/15">
      <div class="space-y-6">
        <h1 class="text-center text-2xl font-semibold text-gray-900">Не удалось проверить сессию</h1>
        <p class="text-sm text-gray-700" role="status">
          Сервер временно недоступен. Проверьте соединение и повторите проверку, чтобы вернуться на нужную страницу.
        </p>
        <UButton size="xl" block color="primary" :loading="loading" :disabled="loading" class="justify-center" @click="retry">
          Повторить проверку
        </UButton>
      </div>
    </UCard>
  </main>
</template>
