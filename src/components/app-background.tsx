export function AppBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#060c18]">
      <div className="absolute -top-[15%] -left-[10%] h-[600px] w-[600px] rounded-full bg-[#c4a44a]/20 blur-[120px] animate-[orb-drift_25s_ease-in-out_infinite]" />
      <div className="absolute -bottom-[20%] -right-[10%] h-[500px] w-[500px] rounded-full bg-sky-500/15 blur-[120px] animate-[orb-drift_20s_ease-in-out_infinite_reverse]" />
      <div className="absolute top-[30%] left-[40%] h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-[100px] animate-[orb-drift_30s_ease-in-out_infinite]" />
    </div>
  );
}
