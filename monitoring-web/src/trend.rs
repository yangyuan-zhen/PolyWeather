use crate::model::Trend;

/// Calculate temperature trend from recent observations.
/// Uses linear regression slope. Observations are newest-first.
pub fn calc_trend(temps: &[f64]) -> Trend {
    let n = temps.len();
    if n < 4 {
        return Trend::Unknown;
    }
    // Reverse to oldest-first for regression
    let values: Vec<f64> = temps.iter().rev().copied().collect();
    let n_f = n as f64;
    let mean_x = (n_f - 1.0) / 2.0;
    let mean_y = values.iter().sum::<f64>() / n_f;

    let mut num = 0.0;
    let mut den = 0.0;
    for (i, &y) in values.iter().enumerate() {
        let x = i as f64;
        num += (x - mean_x) * (y - mean_y);
        den += (x - mean_x) * (x - mean_x);
    }
    if den == 0.0 {
        return Trend::Flat;
    }
    let slope = num / den;
    // Slope is °C per observation interval (~10 min per obs from METAR cluster)
    // Threshold: > +0.2 → rising, < -0.2 → falling
    if slope > 0.2 {
        Trend::Rising
    } else if slope < -0.2 {
        Trend::Falling
    } else {
        Trend::Flat
    }
}
