export function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Hero */}
      <section className="mb-8 border-b-2 border-brand-dark pb-8">
        <h2 className="font-display text-3xl font-black text-brand-dark">
          又看一集
        </h2>
        <p className="mt-2 text-gray-600">
          朋友们的内容分享站
        </p>
      </section>

      {/* Content Grid Placeholder */}
      <section>
        <h3 className="mb-4 font-display text-xl font-bold text-brand-dark">
          最新内容
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {/* Placeholder cards */}
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="aspect-[3/4] border-2 border-gray-200 bg-gray-100 flex items-center justify-center text-gray-400"
            >
              卡片 {i}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
