#pragma once
#include <QList>
#include <QStringList>
#include <QWidget>

#include "engine.hpp"
#include "chart_annotations.hpp"
#include "legacy_indicators.hpp"
#include "vwap.hpp"
#include "chart_extension.hpp"
#include <QJsonArray>
#include <QJsonObject>
class QComboBox;
class Chart final : public QWidget {
  Q_OBJECT
 public:
  explicit Chart(QWidget* parent = nullptr);
  std::vector<market::Bar> bars;
  QStringList labels;
  QString indicator = "MACD", periodName = "日K",
          volumeLabel = "成交量 · 模拟股数";
  int priceDecimals = 2, emaPeriod = 20, atrPeriod = 14, volumePeriod = 20,
      visibleCount = 64, endIndex = 0, selected = -1;
  QList<int> maPeriods{5, 10, 20, 60};
  QString maType = "MA";
  int macdFast = 12, macdSlow = 26, macdSignal = 9;
  int kdjPeriod = 9, rsiPeriod = 14, cciPeriod = 14;
  market::LegacyKdj kdjData;
  std::vector<std::vector<double>> maData;
  bool overlay = true, showNine = true, dark = false, minute = false;
  double previousClose = 0;
  std::vector<double> overlayData, subData, dea, dif;
  std::vector<market::Seq> seq;
  void setSeries(std::vector<market::Bar> data, QStringList dates,
                 bool isMinute, bool reset = true);
  bool annotationsEnabled=false;
  QJsonArray annotationRows;QJsonObject annotationMeta;
  chartAnnotations::Result annotationData;QString annotationError;
  void refreshAnnotations(int index=-2);QString annotationText(int index);
  bool vwapEnabled = false;
  QString vwapMode = "legacy-close-approx", vwapAnchor = "auto", vwapPeriod = "day", vwapError;
  QJsonArray vwapRows;
  QJsonObject vwapMeta;
  vwap::Series vwapData;
  QString vwapText(int index) const;
  void recalculate();
  QString indicatorTitle() const;
  QString indicatorValues(int index) const;
  QString changeText(int index) const;
  void latest();
  QRectF priceRect() const;
  QRectF volumeRect() const;
  QRectF indicatorRect() const;
  double barX(int i) const;
  QMap<QString,chartExtension::Layer> extensionLayers;
  void setExtensionLayer(const QString& owner,const chartExtension::Layer& layer) { extensionLayers[owner]=layer;update(); }
  void removeExtensionLayer(const QString& owner) { extensionLayers.remove(owner);update(); }
 signals:
  void barSelected(int index);
  void indicatorChanged(const QString& name);

 protected:
  void paintEvent(QPaintEvent*) override;
  void hideEvent(QHideEvent*) override;
  void showEvent(QShowEvent*) override;
  void resizeEvent(QResizeEvent*) override;
  void wheelEvent(QWheelEvent*) override;
  void mousePressEvent(QMouseEvent*) override;
  void mouseMoveEvent(QMouseEvent*) override;
  void mouseReleaseEvent(QMouseEvent*) override;
  void keyPressEvent(QKeyEvent*) override;

 private:
  QComboBox* indicatorControl = nullptr;
  int axisWidth() const;
  std::vector<int> displayMacdRun;
  void placeIndicatorControl();
  QJsonArray annotationSourceRows;
  QJsonObject annotationSourceMeta;
  int annotationIndex = -2;
  bool annotationCached = false;
  void refreshAnnotationsFor(int index, bool reader);
  double lastInspectX = NAN;
  QPoint press;
  int startEnd = 0;
  bool dragging = false;
  void selectAt(double x);
};
