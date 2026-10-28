<script setup>
definePageMeta({ layout: "auth" });

const rememberMe = ref(false);
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

                <form class="space-y-4" @submit.prevent>
                    <UFormField label="Логин" required>
                        <UInput
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
                            type="password"
                            name="password"
                            placeholder="Введите пароль"
                            autocomplete="current-password"
                            size="xl"
                            class="w-full"
                        />
                    </UFormField>

                    <UCheckbox
                        v-model="rememberMe"
                        name="remember"
                        label="Запомнить меня"
                        color="primary"
                    />
                    <UButton
                        type="submit"
                        size="xl"
                        block
                        color="primary"
                        class="justify-center"
                    >
                        Войти
                    </UButton>
                </form>
            </div>
        </UCard>
    </main>
</template>

