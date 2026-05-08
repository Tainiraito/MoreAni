import { ref, onMounted, onUnmounted } from 'vue'

export function useResponsiveDialog(desktopWidth: string) {
  const dialogWidth = ref(window.innerWidth < 768 ? '95%' : desktopWidth)

  function onResize() {
    dialogWidth.value = window.innerWidth < 768 ? '95%' : desktopWidth
  }

  onMounted(() => window.addEventListener('resize', onResize))
  onUnmounted(() => window.removeEventListener('resize', onResize))

  return { dialogWidth }
}
