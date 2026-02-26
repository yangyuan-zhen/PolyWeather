import os
import json
import logging
from datetime import datetime, timedelta

def load_history(filepath):
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_history(filepath, data):
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def update_daily_record(city_name, date_str, forecasts, actual_high):
    """
    保存/更新某城市某天的各个模型预报与最终实测值
    forecasts: dict, 例如 {"ECMWF": 28.5, "GFS": 30.0, ...}
    actual_high: float, 最终实测最高温
    """
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    history_file = os.path.join(project_root, 'data', 'daily_records.json')
    
    data = load_history(history_file)
    if city_name not in data:
        data[city_name] = {}
        
    if date_str not in data[city_name]:
        data[city_name][date_str] = {}
    
    data[city_name][date_str]['forecasts'] = forecasts
    # 只要仍在更新或者已经结束，都记录最新高点
    data[city_name][date_str]['actual_high'] = actual_high
    
    save_history(history_file, data)

def calculate_dynamic_weights(city_name, current_forecasts, lookback_days=7):
    """
    计算动态权重融合 (Dynamic Ensemble Blending, DEB)
    根据过去 N 天各模型的 Mean Absolute Error (MAE) 计算倒数权重
    返回: blended_high (融合预报值), weights_info (权重展示字符串)
    """
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    history_file = os.path.join(project_root, 'data', 'daily_records.json')
    data = load_history(history_file)
    
    if city_name not in data or not data[city_name]:
        # 没有历史数据，返回简单的平均/中位数
        valid_vals = [v for v in current_forecasts.values() if v is not None]
        if not valid_vals: return None, "暂无模型数据"
        avg = sum(valid_vals) / len(valid_vals)
        return round(avg, 1), "等权平均(历史数据不足)"
        
    # 获取过去 lookback_days 天的有 actual_high 的记录
    city_data = data[city_name]
    sorted_dates = sorted(city_data.keys(), reverse=True)
    
    # 我们只用真正结清（或者有比较准确最高温）的历史来算误差
    # 这边简化：凡是有 actual_high 的都算进去
    errors = {model: [] for model in current_forecasts.keys()}
    
    days_used = 0
    for date_str in sorted_dates:
        # 跳过今天，今天还没出最终结果
        if date_str == datetime.now().strftime("%Y-%m-%d"):
            continue
            
        record = city_data[date_str]
        actual = record.get('actual_high')
        past_forecasts = record.get('forecasts', {})
        
        if actual is None:
            continue
            
        for model in current_forecasts.keys():
            if model in past_forecasts and past_forecasts[model] is not None:
                errors[model].append(abs(past_forecasts[model] - actual))
                
        days_used += 1
        if days_used >= lookback_days:
            break
            
    # 如果有效历史天数 < 2 天，还是使用等权
    if days_used < 2:
        valid_vals = [v for v in current_forecasts.values() if v is not None]
        avg = sum(valid_vals) / len(valid_vals)
        return round(avg, 1), f"等权平均(由于仅{days_used}天历史)"
        
    # 计算 MAE
    maes = {}
    for model, err_list in errors.items():
        if err_list:
            maes[model] = sum(err_list) / len(err_list)
        else:
            # 如果某个新模型没有历史数据，给它一个平均误差
            maes[model] = 2.0 
            
    # 计算权重（用 MAE 的倒数，误差越小权重越大；加 0.1 防止除以0）
    inverse_errors = {m: 1.0 / (mae + 0.1) for m, mae in maes.items() if current_forecasts.get(m) is not None}
    
    total_inv = sum(inverse_errors.values())
    if total_inv == 0:
        return None, "权重计算异常"
        
    weights = {m: inv / total_inv for m, inv in inverse_errors.items()}
    
    # 计算加权最高温
    blended_high = 0.0
    for m in weights.keys():
        blended_high += current_forecasts[m] * weights[m]
        
    # 格式化权重信息，挑选前权重最高的2-3个模型展示
    sorted_models = sorted(weights.items(), key=lambda x: x[1], reverse=True)
    weight_str_parts = []
    for m, w in sorted_models[:3]:
         weight_str_parts.append(f"{m}({w*100:.0f}%,MAE:{maes[m]:.1f}°)")
         
    return round(blended_high, 1), " | ".join(weight_str_parts)

