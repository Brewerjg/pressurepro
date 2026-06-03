export default function Test() {
  return (
    <div style={{ backgroundColor: 'blue', color: 'white', padding: '20px', fontSize: '24px' }}>
      <h1>Test Page - If you see this, React is working!</h1>
      <p>Background should be blue with white text.</p>
      <div className="bg-red-500 text-white p-4 mt-4 rounded">
        This div uses Tailwind classes (red background)
      </div>
    </div>
  );
}