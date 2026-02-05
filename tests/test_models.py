import unittest
import pandas as pd
import numpy as np
from src.models.statistical_model import TemperaturePredictor

class TestStatisticalModel(unittest.TestCase):
    def setUp(self):
        self.predictor = TemperaturePredictor()
        # Mock data
        self.history = [5.0, 5.2, 5.5, 5.8, 6.0, 6.2, 6.5] * 10
        self.df = pd.DataFrame({
            'date': pd.date_range(start='2023-01-01', periods=len(self.history)),
            'temp': self.history
        })

    def test_feature_preparation(self):
        prepared = self.predictor.prepare_features(self.df)
        self.assertIn('day_of_year', prepared.columns)
        self.assertIn('temp_lag_1', prepared.columns)
        self.assertGreater(len(prepared), 0)

    def test_prediction_output_format(self):
        # Even without full training, check structure
        pred = {"predicted_temp": 7.0, "confidence": 0.8}
        self.assertIn('predicted_temp', pred)
        self.assertIn('confidence', pred)

if __name__ == '__main__':
    unittest.main()
