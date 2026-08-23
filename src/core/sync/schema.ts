export const bookSchema = {
    version: 1,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        title: {
            type: 'string'
        },
        author: {
            type: 'string'
        },
        cover: {
            type: 'string'
        },
        totalWords: {
            type: 'number',
            default: 0
        },
        chapterIds: {
            type: 'array',
            items: {
                type: 'string'
            }
        },
        structureVersion: {
            type: 'number'
        },
        structureMode: {
            type: 'string',
            enum: ['authored', 'hybrid', 'generated']
        },
        globalSummaries: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    startWordIndex: { type: 'number' },
                    endWordIndex: { type: 'number' },
                    startChapterId: { type: 'string' },
                    endChapterId: { type: 'string' },
                    summary: { type: 'string' },
                    generatedAt: { type: 'number' }
                }
            }
        }
    },
    required: ['id', 'title']
} as const;

export const imageSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        bookId: {
            type: 'string',
            maxLength: 100
        },
        filename: {
            type: 'string'
        },
        data: {
            type: 'string' // Base64
        },
        mimeType: {
            type: 'string'
        }
    },
    required: ['id', 'bookId', 'filename', 'data']
} as const;

export const chapterSchema = {
    version: 4,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        bookId: {
            type: 'string',
            maxLength: 100
        },
        index: {
            type: 'number'
        },
        title: {
            type: 'string'
        },
        status: {
            type: 'string',
            enum: ['pending', 'processing', 'ready', 'error'],
            default: 'pending'
        },
        progress: {
            type: 'number',
            default: 0
        },
        processingSpeed: {
            type: 'number', // WPM
            default: 0
        },
        lastTPM: {
            type: 'number', // Tokens Per Minute
            default: 0
        },
        lastChunkCompletedAt: {
            type: 'number', // Timestamp (ms since epoch)
            default: 0
        },
        content: {
            type: 'array',
            items: {
                type: 'string'
            }
        },
        paragraphBreaks: {
            type: 'array',
            items: {
                type: 'number'
            }
        },
        notes: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    kind: {
                        type: 'string',
                        enum: ['footnote', 'endnote', 'translator-note', 'editor-note', 'unknown']
                    },
                    label: { type: 'string' },
                    text: { type: 'string' },
                    pageStart: { type: 'number' },
                    pageEnd: { type: 'number' },
                    sourceRegionIds: { type: 'array', items: { type: 'string' } },
                    confidence: { type: 'number' },
                    issues: { type: 'array', items: { type: 'string' } },
                },
                required: ['id', 'kind', 'text', 'pageStart', 'pageEnd', 'sourceRegionIds', 'confidence', 'issues']
            }
        },
        noteAnchors: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    noteId: { type: 'string' },
                    chapterId: { type: 'string' },
                    wordIndex: { type: 'number' },
                    sourcePage: { type: 'number' },
                    markerText: { type: 'string' },
                    confidence: { type: 'number' },
                    evidence: { type: 'array', items: { type: 'string' } },
                },
                required: ['id', 'noteId', 'chapterId', 'wordIndex', 'sourcePage', 'confidence', 'evidence']
            }
        },
        densities: {
            type: 'array',
            items: {
                type: 'number'
            }
        },
        analysisData: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    tokens: { type: 'array', items: { type: 'string' } },
                    surprisals: { type: 'array', items: { type: 'number' } }
                }
            }
        },
        subchapters: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    startWordIndex: { type: 'number' },
                    endWordIndex: { type: 'number' }
                }
            }
        },
        metadata: {
            type: 'object',
            properties: {
                classificationType: { 
                    type: 'string',
                    enum: ['content', 'license', 'toc', 'cover', 'frontmatter', 'backmatter', 'image']
                },
                classificationReason: { type: 'string' },
                structureSource: {
                    type: 'string',
                    enum: ['toc', 'heading', 'spine', 'merged']
                },
                structureOwnership: {
                    type: 'string',
                    enum: ['authored', 'xyz']
                },
                reformationReason: {
                    type: 'string',
                    enum: ['authored-boundary', 'page-sequence', 'long-section-split', 'short-section-merge', 'format-fallback']
                },
                boundaryEvidence: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['publisher-toc', 'document-heading', 'scan-heading', 'source-spine']
                    }
                },
                authoredGroupTitle: { type: 'string' },
                originalTitles: {
                    type: 'array',
                    items: { type: 'string' }
                },
                licenseInfo: {
                    type: 'object',
                    properties: {
                        publisher: { type: 'string' },
                        text: { type: 'string' }
                    }
                },
                tocEntries: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            href: { type: 'string' }
                        }
                    }
                }
            }
        }
    },
    required: ['id', 'bookId', 'index', 'content'],
    indexes: ['bookId']
} as const;

export const rawFileSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        data: {
            type: 'string' // Base64
        }
    },
    required: ['id', 'data']
} as const;

export const textIssueSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 240 },
        bookId: { type: 'string', maxLength: 100 },
        sourceUnitId: { type: 'string', maxLength: 200 },
        revisionHash: { type: 'string', maxLength: 128 },
        startOffset: { type: 'number' },
        endOffset: { type: 'number' },
        originalHash: { type: 'string', maxLength: 128 },
        detectorIds: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'object' },
        severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        ambiguity: { type: 'string', enum: ['low', 'medium', 'high'] },
        state: { type: 'string', maxLength: 20, enum: ['open', 'accepted', 'kept-original', 'rejected', 'stale'] },
        proposal: { type: 'object' },
        createdAt: { type: 'number' },
        updatedAt: { type: 'number' },
    },
    required: [
        'id', 'bookId', 'sourceUnitId', 'revisionHash', 'startOffset', 'endOffset',
        'originalHash', 'detectorIds', 'evidence', 'severity', 'ambiguity',
        'state', 'createdAt', 'updatedAt',
    ],
    indexes: ['bookId', 'sourceUnitId', 'revisionHash', 'state'],
} as const;

export const contentRevisionSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 240 },
        bookId: { type: 'string', maxLength: 100 },
        sourceUnitId: { type: 'string', maxLength: 200 },
        parentRevisionId: { type: 'string', maxLength: 240 },
        sourceHash: { type: 'string', maxLength: 128 },
        textHash: { type: 'string', maxLength: 128 },
        pipelineVersion: { type: 'string' },
        acceptedPatchIds: { type: 'array', items: { type: 'string' } },
        createdAt: { type: 'number' },
        state: { type: 'string', maxLength: 20, enum: ['prepared', 'active', 'superseded'] },
    },
    required: [
        'id', 'bookId', 'sourceUnitId', 'sourceHash', 'textHash', 'pipelineVersion',
        'acceptedPatchIds', 'createdAt', 'state',
    ],
    indexes: ['bookId', 'sourceUnitId', 'state'],
} as const;

export const repairAnnotationSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 240 },
        bookId: { type: 'string', maxLength: 100 },
        sourceUnitId: { type: 'string', maxLength: 200 },
        sourceRevisionId: { type: 'string', maxLength: 240 },
        canonicalRevisionId: { type: 'string', maxLength: 240 },
        sourceAnchor: { type: 'object' },
        canonicalAnchor: { type: 'object' },
        originalText: { type: 'string' },
        replacementText: { type: 'string' },
        action: { type: 'string', enum: ['keep', 'replace', 'delete', 'merge', 'split'] },
        detectorIds: { type: 'array', items: { type: 'string' } },
        detectorEvidence: { type: 'object' },
        modelFingerprint: { type: 'string' },
        promptFingerprint: { type: 'string' },
        validatorFingerprint: { type: 'string' },
        pipelineFingerprint: { type: 'string' },
        proposalState: { type: 'string', maxLength: 20, enum: ['proposed', 'accepted', 'kept-original', 'rejected', 'superseded'] },
        acceptedAt: { type: 'number' },
        acceptanceAction: { type: 'string', enum: ['accept', 'keep-original', 'accept-all-safe'] },
        renderRange: { type: 'object' },
    },
    required: [
        'id', 'bookId', 'sourceUnitId', 'sourceRevisionId', 'canonicalRevisionId',
        'sourceAnchor', 'canonicalAnchor', 'action', 'detectorIds', 'detectorEvidence',
        'validatorFingerprint', 'pipelineFingerprint', 'proposalState', 'renderRange',
    ],
    indexes: ['bookId', 'sourceUnitId', 'sourceRevisionId', 'canonicalRevisionId'],
} as const;

export const processingJobSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 240 },
        dedupeKey: { type: 'string', maxLength: 500 },
        feature: { type: 'string', enum: ['pacing', 'repair', 'structure', 'summary', 'tts-annotation'] },
        bookId: { type: 'string', maxLength: 100 },
        sourceUnitId: { type: 'string', maxLength: 200 },
        inputRevisionHash: { type: 'string', maxLength: 128 },
        modelFingerprint: { type: 'string', maxLength: 240 },
        pipelineVersion: { type: 'string' },
        state: { type: 'string', maxLength: 20, enum: ['pending', 'running', 'blocked', 'completed', 'failed', 'cancelled', 'stale'] },
        attemptCount: { type: 'number' },
        checkpoint: { type: 'string' },
        createdAt: { type: 'number' },
        updatedAt: { type: 'number' },
    },
    required: [
        'id', 'dedupeKey', 'feature', 'bookId', 'inputRevisionHash', 'modelFingerprint',
        'pipelineVersion', 'state', 'attemptCount', 'createdAt', 'updatedAt',
    ],
    indexes: ['bookId', 'dedupeKey', 'state'],
} as const;

export const readingStateSchema = {
    version: 0,
    primaryKey: 'bookId',
    type: 'object',
    properties: {
        bookId: {
            type: 'string',
            maxLength: 100
        },
        currentChapterId: {
            type: 'string'
        },
        currentWordIndex: {
            type: 'number',
            default: 0
        },
        lastRead: {
            type: 'number',
            default: 0
        },
        highlights: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    chapterId: { type: 'string' },
                    startWordIndex: { type: 'number' },
                    endWordIndex: { type: 'number' },
                    text: { type: 'string' },
                    note: { type: 'string' },
                    createdAt: { type: 'number' }
                }
            }
        },
        // TTS Position - syncs between devices for seamless reading/listening
        ttsPosition: {
            type: 'object',
            properties: {
                chapterId: { type: 'string' },
                sentenceIndex: { type: 'number' },
                wordIndex: { type: 'number' },
                audioTime: { type: 'number' }, // Seconds into audio
                timestamp: { type: 'number' }  // When position was saved
            }
        },
        // TTS Settings - syncs user preferences
        ttsSettings: {
            type: 'object',
            properties: {
                voice: { type: 'string' },
                speed: { type: 'number' }
            }
        }
    },
    required: ['bookId']
} as const;
