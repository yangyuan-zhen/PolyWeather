import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Search,
  Sun,
  Wind,
} from "lucide-react";

export function WeatherIcon({ emoji, size = 32 }: { emoji: string; size?: number }) {
  if (emoji === "☀️") return <Sun size={size} color="#facc15" />;
  if (emoji === "⛅" || emoji === "🌤️")
    return <CloudSun size={size} color="#4DA3FF" />;
  if (emoji === "☁️") return <Cloud size={size} color="#9FB2C7" />;
  if (emoji === "🌧️" || emoji === "🌦️")
    return <CloudRain size={size} color="#60a5fa" />;
  if (emoji === "⛈️") return <CloudLightning size={size} color="#c084fc" />;
  if (emoji === "❄️" || emoji === "🌨️")
    return <CloudSnow size={size} color="#7dd3fc" />;
  if (emoji === "🌫️") return <CloudFog size={size} color="#a1a1aa" />;
  if (emoji === "💨") return <Wind size={size} color="#cbd5e1" />;
  return <Search size={size} color="#6B7A90" />;
}
