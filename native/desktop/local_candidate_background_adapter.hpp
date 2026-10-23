#pragma once
#include "local_candidate_model.hpp"
namespace localCandidateBackgroundAdapter {
inline const QString version="native-candidate-background-adapter/v1";
QString sourceDigest(const QJsonValue& data);
QJsonObject freeze(const QJsonObject& input,const localCandidate::Cancel& cancelled={});
void verify(const QJsonObject& result,const localCandidate::Cancel& cancelled={});
}
