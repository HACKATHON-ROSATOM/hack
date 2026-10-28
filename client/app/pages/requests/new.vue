<script setup>
import { equipmentItems } from '~/data/equipment'
import { useUserStore } from '~/stores/user'

const route = useRoute()
const userStore = useUserStore()

const equipmentOptions = equipmentItems.map((item) => ({
  label: item.name + ' (' + item.id + ')',
  value: item.id,
}))
const initialEquipment = equipmentItems.some((item) => item.id === String(route.query.equipmentId))
  ? String(route.query.equipmentId)
  : undefined

const equipmentId = ref(initialEquipment)
const kind = ref()
const priority = ref()
const description = ref('')
const due = ref('')

const kindOptions = [
  { label: 'Осмотр', value: 'Осмотр' },
  { label: 'Ремонт', value: 'Ремонт' },
]
const priorityOptions = [
  { label: 'Низкий', value: 'Низкий' },
  { label: 'Средний', value: 'Средний' },
  { label: 'Высокий', value: 'Высокий' },
  { label: 'Критичный', value: 'Критичный' },
]
</script>

<template>
  <main class="mx-auto max-w-3xl space-y-6 px-4 py-10">
    <template v-if="userStore.role === 'dispatcher'">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">Новая заявка</h1>
      </div>

      <UCard class="bg-white ring-1 ring-brand/15">
        <form class="space-y-4" @submit.prevent>
          <UFormField label="Тип заявки" required>
            <USelect v-model="kind" :items="kindOptions" value-key="value" placeholder="Выберите тип" class="w-full" />
          </UFormField>
          <UFormField label="Оборудование" required>
            <USelect v-model="equipmentId" :items="equipmentOptions" value-key="value" placeholder="Выберите объект" class="w-full" />
          </UFormField>
          <UFormField label="Описание" required>
            <UTextarea v-model="description" placeholder="Опишите задачу" :rows="4" class="w-full" />
          </UFormField>
          <UFormField label="Приоритет" required>
            <USelect v-model="priority" :items="priorityOptions" value-key="value" placeholder="Выберите приоритет" class="w-full" />
          </UFormField>
          <UFormField label="Плановый срок" required>
            <UInput v-model="due" type="datetime-local" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton to="/requests" variant="outline">Отмена</UButton>
            <UButton type="button">Создать заявку</UButton>
          </div>
        </form>
      </UCard>
    </template>

    <UCard v-else class="bg-white ring-1 ring-brand/15">
      <h1 class="text-xl font-semibold text-gray-900">Создание заявок доступно дежурному</h1>
      <UButton to="/requests" variant="link" class="mt-3 p-0">К списку заявок</UButton>
    </UCard>
  </main>
</template>


