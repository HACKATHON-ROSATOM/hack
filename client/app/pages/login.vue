<script setup>
import { useUserStore } from '~/stores/user'

definePageMeta({ layout: "auth" });

const userStore = useUserStore();
const route = useRoute();
const login = ref('');
const password = ref('');
const loading = ref(false);
const ready = ref(false);
onMounted(() => { ready.value = true; });
const error = ref(route.query.session === 'expired'
    ? 'Сессия завершилась. Войдите снова.'
    : route.query.session === 'unavailable'
        ? 'Не удалось проверить сессию. Проверьте соединение с сервером.'
        : '');

async function submit() {
    if (loading.value) return;
    loading.value = true;
    error.value = '';
    try {
        await userStore.login(login.value, password.value);
        password.value = '';
        await navigateTo('/');
    } catch (err) {
        error.value = err?.statusCode === 401 || err?.response?.status === 401
            ? 'Неверный логин или пароль.'
            : 'Не удалось войти. Проверьте соединение и повторите попытку.';
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <main
        class="flex min-h-screen items-center justify-center bg-brand/5 px-4 py-10"
    >
        <UCard class="w-full max-w-sm bg-white shadow-sm ring-1 ring-brand/15">
            <div class="space-y-6">
                <div class="text-center">
                    <h1 class="mt-2 text-2xl font-semibold text-gray-900">
                        Вход в систему
                    </h1>
                </div>

                <form method="post" class="space-y-4" @submit.prevent="submit">
                    <UFormField label="Логин" required>
                        <UInput
                            v-model="login"
                            required
                            type="text"
                            name="username"
                            placeholder="Введите логин"
                            autocomplete="username"
                            size="xl"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField label="Пароль" required>
                        <UInput
                            v-model="password"
                            required
                            type="password"
                            name="password"
                            placeholder="Введите пароль"
                            autocomplete="current-password"
                            size="xl"
                            class="w-full"
                        />
                    </UFormField>

                    <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
                    <UButton
                        type="submit"
                        size="xl"
                        block
                        color="primary"
                        :loading="loading"
                        :disabled="loading || !ready"
                        class="justify-center"
                    >
                        Войти
                    </UButton>
                </form>
            </div>
        </UCard>
    </main>
</template>

