<script setup>
import { useUserStore } from '~/stores/user'
import { apiProblem } from '~/utils/apiProblem'

definePageMeta({ layout: 'auth' })

const userStore = useUserStore()
const state = reactive({ login: '', password: '' })
const loading = ref(false)
const sessionMessages = {
  expired: 'Сессия завершилась. Войдите снова.',
  unavailable: 'Не удалось проверить сессию. Проверьте соединение с сервером.',
}
const formError = ref(sessionMessages[useRoute().query.session] || '')

async function submit() {
  if (loading.value) return
  loading.value = true
  formError.value = ''
  try {
    await userStore.login(state.login.trim(), state.password.trim())
    state.password = ''
    await navigateTo('/')
  } catch (error) {
    const problem = apiProblem(error)
    formError.value = problem.status === 400 || problem.status === 401
      ? 'Неверный логин или пароль.'
      : 'Не удалось войти. Проверьте соединение с сервером.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-brand/5 px-4 py-10">
    <UCard class="w-full max-w-sm bg-white shadow-sm ring-1 ring-brand/15">
      <div class="space-y-6">
        <h1 class="text-center text-2xl font-semibold text-gray-900">Вход в систему</h1>

        <UForm :state="state" class="space-y-4" @submit="submit">
          <UFormField name="login" label="Логин" required>
            <UInput v-model.trim="state.login" name="username" placeholder="Введите логин" autocomplete="username" size="xl" class="w-full" />
          </UFormField>

          <UFormField name="password" label="Пароль" required>
            <UInput v-model.trim="state.password" type="password" name="password" placeholder="Введите пароль" autocomplete="current-password" size="xl" class="w-full" />
          </UFormField>

          <p v-if="formError" role="alert" class="text-sm text-red-600">{{ formError }}</p>
          <UButton type="submit" size="xl" block color="primary" :loading="loading" :disabled="loading" class="justify-center">Войти</UButton>
        </UForm>
      </div>
    </UCard>
  </main>
</template>

