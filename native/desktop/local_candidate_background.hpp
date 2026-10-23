#pragma once
#include "local_candidate_model.hpp"
namespace localCandidateBackground {
inline const QString businessVersion="native-candidate-background/v2-business-demand", businessCandidateVersion="native-local-candidates/v3-business-demand";
inline const QString version="native-candidate-background/v1";
inline const QString candidateVersion="native-local-candidates/v2-background";
QJsonObject evaluate(const QJsonObject& input,const QString& securityId,const QString& strategy,const QDateTime& capturedAt,const localCandidate::Cancel& cancelled={});
QJsonObject apply(QJsonObject row,const QJsonObject& input,const QString& strategy,const QDateTime& capturedAt,const localCandidate::Cancel& cancelled={});
}
