import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from loguru import logger

try:
    from statsmodels.tsa.arima.model import ARIMA
    HAS_STATSMODELS = True
except ImportError:
    HAS_STATSMODELS = False
    logger.debug("statsmodels not installed, ARIMA model unavailable")

try:
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.model_selection import train_test_split
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    logger.debug("scikit-learn not installed, ML models unavailable")


class TemperaturePredictor:
    """
    Temperature prediction model using statistical and ML methods
    
    Supports:
    - ARIMA for time series prediction
    - Random Forest for feature-based prediction
    - Ensemble of both methods
    """
    
    def __init__(self, config: dict = None):
        self.config = config or {}
        self.arima_order = self.config.get("arima_order", (5, 1, 2))
        self.rf_estimators = self.config.get("rf_estimators", 100)
        
        self.arima_model = None
        self.rf_model = None
        self.is_trained = False
        
        logger.info("Temperature Predictor initialized")

    def prepare_features(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Prepare features for ML model
        
        Args:
            data: DataFrame with temperature history
            
        Returns:
            DataFrame: Feature-engineered data
        """
        df = data.copy()
        
        # Time-based features
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'])
            df['day_of_year'] = df['date'].dt.dayofyear
            df['month'] = df['date'].dt.month
            df['day_of_week'] = df['date'].dt.dayofweek
        
        # Lag features
        if 'temp' in df.columns:
            for lag in [1, 2, 3, 7, 14]:
                df[f'temp_lag_{lag}'] = df['temp'].shift(lag)
            
            # Rolling statistics
            df['temp_rolling_mean_7'] = df['temp'].rolling(window=7).mean()
            df['temp_rolling_std_7'] = df['temp'].rolling(window=7).std()
            df['temp_rolling_mean_14'] = df['temp'].rolling(window=14).mean()
        
        # Drop NaN rows created by lag features
        df = df.dropna()
        
        return df

    def train_arima(self, temperature_series: List[float]) -> bool:
        """
        Train ARIMA model on temperature time series
        
        Args:
            temperature_series: List of historical temperatures
            
        Returns:
            bool: Success status
        """
        if not HAS_STATSMODELS:
            logger.error("statsmodels required for ARIMA training")
            return False
        
        if len(temperature_series) < 30:
            logger.warning("Insufficient data for ARIMA training (need 30+ points)")
            return False
        
        try:
            series = np.array(temperature_series)
            model = ARIMA(series, order=self.arima_order)
            self.arima_model = model.fit()
            logger.info(f"ARIMA model trained. AIC: {self.arima_model.aic:.2f}")
            return True
        except Exception as e:
            logger.error(f"ARIMA training failed: {e}")
            return False

    def train_random_forest(self, 
                            features: pd.DataFrame, 
                            target_col: str = 'temp') -> bool:
        """
        Train Random Forest model
        
        Args:
            features: Feature DataFrame
            target_col: Target column name
            
        Returns:
            bool: Success status
        """
        if not HAS_SKLEARN:
            logger.error("scikit-learn required for Random Forest training")
            return False
        
        if len(features) < 50:
            logger.warning("Insufficient data for RF training (need 50+ rows)")
            return False
        
        try:
            # Prepare data
            feature_cols = [c for c in features.columns 
                          if c not in [target_col, 'date', 'datetime']]
            
            X = features[feature_cols].values
            y = features[target_col].values
            
            # Train-test split
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42
            )
            
            # Train model
            self.rf_model = RandomForestRegressor(
                n_estimators=self.rf_estimators,
                random_state=42,
                n_jobs=-1
            )
            self.rf_model.fit(X_train, y_train)
            
            # Evaluate
            train_score = self.rf_model.score(X_train, y_train)
            test_score = self.rf_model.score(X_test, y_test)
            
            logger.info(f"Random Forest trained. Train R²: {train_score:.4f}, Test R²: {test_score:.4f}")
            
            # Store feature names
            self.feature_names = feature_cols
            
            return True
        except Exception as e:
            logger.error(f"Random Forest training failed: {e}")
            return False

    def predict_arima(self, steps: int = 1) -> Optional[Dict]:
        """
        Make prediction using ARIMA model
        
        Args:
            steps: Number of steps to forecast
            
        Returns:
            dict: Prediction with confidence interval
        """
        if self.arima_model is None:
            logger.warning("ARIMA model not trained")
            return None
        
        try:
            forecast = self.arima_model.forecast(steps=steps)
            conf_int = self.arima_model.get_forecast(steps=steps).conf_int()
            
            return {
                "method": "ARIMA",
                "predicted_temp": float(forecast[0]) if steps == 1 else [float(f) for f in forecast],
                "confidence_interval": [float(conf_int.iloc[0, 0]), float(conf_int.iloc[0, 1])] if steps == 1 else conf_int.values.tolist()
            }
        except Exception as e:
            logger.error(f"ARIMA prediction failed: {e}")
            return None

    def predict_rf(self, features: np.ndarray) -> Optional[Dict]:
        """
        Make prediction using Random Forest model
        
        Args:
            features: Feature array for prediction
            
        Returns:
            dict: Prediction result
        """
        if self.rf_model is None:
            logger.warning("Random Forest model not trained")
            return None
        
        try:
            prediction = self.rf_model.predict(features.reshape(1, -1))[0]
            
            # Estimate confidence using tree variance
            tree_predictions = [tree.predict(features.reshape(1, -1))[0] 
                               for tree in self.rf_model.estimators_]
            std = np.std(tree_predictions)
            
            return {
                "method": "RandomForest",
                "predicted_temp": float(prediction),
                "confidence_interval": [float(prediction - 1.96 * std), 
                                        float(prediction + 1.96 * std)],
                "std": float(std)
            }
        except Exception as e:
            logger.error(f"Random Forest prediction failed: {e}")
            return None

    def predict_ensemble(self, 
                         temperature_history: List[float],
                         feature_data: pd.DataFrame = None,
                         arima_weight: float = 0.4,
                         rf_weight: float = 0.6) -> Dict:
        """
        Make ensemble prediction combining ARIMA and Random Forest
        
        Args:
            temperature_history: Historical temperature series
            feature_data: Feature data for RF prediction
            arima_weight: Weight for ARIMA prediction
            rf_weight: Weight for RF prediction
            
        Returns:
            dict: Ensemble prediction
        """
        predictions = []
        weights = []
        
        # ARIMA prediction
        if self.arima_model is not None:
            arima_pred = self.predict_arima(steps=1)
            if arima_pred:
                predictions.append(arima_pred["predicted_temp"])
                weights.append(arima_weight)
        
        # Random Forest prediction
        if self.rf_model is not None and feature_data is not None:
            # Get latest features
            prepared = self.prepare_features(feature_data)
            if len(prepared) > 0 and hasattr(self, 'feature_names'):
                latest_features = prepared[self.feature_names].iloc[-1].values
                rf_pred = self.predict_rf(latest_features)
                if rf_pred:
                    predictions.append(rf_pred["predicted_temp"])
                    weights.append(rf_weight)
        
        if not predictions:
            logger.debug("No predictions available (Model not trained)")
            return {
                "predicted_temp": None,
                "confidence": 0.5,
                "error": "No models available for prediction"
            }
        
        # Weighted average
        weights = np.array(weights) / np.sum(weights)  # Normalize weights
        ensemble_pred = np.average(predictions, weights=weights)
        
        # Estimate confidence based on model agreement
        if len(predictions) > 1:
            spread = abs(predictions[0] - predictions[1])
            confidence = max(0.5, 1.0 - spread / 5.0)  # Lower confidence if predictions differ
        else:
            confidence = 0.7
        
        return {
            "predicted_temp": float(ensemble_pred),
            "confidence": confidence,
            "confidence_interval": [ensemble_pred - 2.0, ensemble_pred + 2.0],  # Approximate
            "individual_predictions": predictions,
            "weights": weights.tolist()
        }
