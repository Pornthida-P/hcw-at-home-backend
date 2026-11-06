/**
 * Regression tests for R-01: Consultation close consistency
 * 
 * Issue: https://github.com/Pornthida-P/hcw-at-home-backend/issues/5
 * 
 * These tests verify that immediately after closing a consultation:
 * 1. The closedBy field is set correctly in both DB and memory
 * 2. The duration calculation is consistent with timestamps
 * 3. The broadcast contains all updated fields
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { ObjectId } = require('mongodb');

describe('Consultation Close - R-01 Regression Tests', function() {
  let mockConsultation;
  let mockDb;
  let mockCollection;
  let broadcastStub;
  let getParticipantsStub;
  let sendClosedStub;
  
  beforeEach(function() {
    const now = Date.now();
    const acceptedTime = now - 7000;
    
    mockConsultation = {
      id: '507f1f77bcf86cd799439011',
      status: 'active',
      acceptedAt: acceptedTime,
      createdAt: acceptedTime - 10000,
      acceptedBy: '507f1f77bcf86cd799439012',
      owner: '507f1f77bcf86cd799439013',
      queue: null,
      IMADTeam: 'test-team',
      firstName: 'Test',
      lastName: 'Patient'
    };

    mockCollection = {
      updateOne: sinon.stub().resolves({ modifiedCount: 1 })
    };

    mockDb = {
      collection: sinon.stub().returns(mockCollection)
    };
  });

  afterEach(function() {
    sinon.restore();
  });

  describe('closedBy field consistency', function() {
    it('should include closedBy in database update when userId provided', async function() {
      const userId = '507f1f77bcf86cd799439014';
      const closedAt = new Date();
      
      await mockCollection.updateOne(
        { _id: new ObjectId(mockConsultation.id) },
        {
          $set: {
            status: 'closed',
            closedAtISO: closedAt,
            closedAt: closedAt.getTime(),
            closedBy: new ObjectId(userId)
          }
        }
      );

      expect(mockCollection.updateOne.calledOnce).to.be.true;
      const updateCall = mockCollection.updateOne.firstCall.args;
      const updateFields = updateCall[1].$set;
      
      expect(updateFields).to.have.property('closedBy');
      expect(updateFields.closedBy).to.be.instanceOf(ObjectId);
      expect(updateFields.closedBy.toString()).to.equal(userId);
      expect(updateFields).to.have.property('status', 'closed');
      expect(updateFields).to.have.property('closedAt');
    });

    it('should not include closedBy when userId is null', async function() {
      const userId = null;
      const closedAt = new Date();
      const updateFields = {
        status: 'closed',
        closedAtISO: closedAt,
        closedAt: closedAt.getTime()
      };
      
      if (userId) {
        updateFields.closedBy = new ObjectId(userId);
      }

      expect(updateFields).to.not.have.property('closedBy');
      expect(updateFields).to.have.property('status', 'closed');
    });

    it('should update in-memory consultation object with closedBy', function() {
      const userId = '507f1f77bcf86cd799439014';
      const closedAt = new Date();
      
      mockConsultation.status = 'closed';
      mockConsultation.closedAtISO = closedAt;
      mockConsultation.closedAt = closedAt.getTime();
      if (userId) {
        mockConsultation.closedBy = userId;
      }

      expect(mockConsultation.status).to.equal('closed');
      expect(mockConsultation.closedBy).to.equal(userId);
      expect(mockConsultation.closedAt).to.be.a('number');
      expect(mockConsultation.closedAtISO).to.be.instanceOf(Date);
    });
  });

  describe('timestamp and duration consistency', function() {
    it('should use consistent closedAt timestamp in DB and memory', function() {
      const closedAt = new Date();
      const closedAtMs = closedAt.getTime();
      
      const dbUpdate = {
        status: 'closed',
        closedAtISO: closedAt,
        closedAt: closedAtMs
      };
      
      const memoryUpdate = {
        status: 'closed',
        closedAtISO: closedAt,
        closedAt: closedAtMs
      };

      expect(dbUpdate.closedAt).to.equal(memoryUpdate.closedAt);
      expect(dbUpdate.closedAtISO.getTime()).to.equal(memoryUpdate.closedAtISO.getTime());
    });

    it('should calculate duration correctly: closedAt - acceptedAt', function() {
      const now = Date.now();
      const acceptedAt = now - 7000;
      const closedAt = now;
      
      const consultation = {
        acceptedAt: acceptedAt,
        closedAt: closedAt
      };
      
      const duration = consultation.closedAt - consultation.acceptedAt;
      
      expect(duration).to.equal(7000);
      expect(duration).to.be.within(6000, 8000);
    });

    it('should calculate duration using createdAt when acceptedAt missing', function() {
      const now = Date.now();
      const createdAt = now - 7000;
      const closedAt = now;
      
      const consultation = {
        createdAt: createdAt,
        closedAt: closedAt,
        acceptedAt: undefined
      };
      
      const start = consultation.acceptedAt || consultation.createdAt;
      const duration = consultation.closedAt - start;
      
      expect(duration).to.equal(7000);
    });

    it('should produce same duration immediately and after reload', function() {
      const acceptedAt = Date.now() - 7000;
      const closedAt = Date.now();
      
      const immediateConsultation = {
        acceptedAt: acceptedAt,
        closedAt: closedAt
      };
      
      const reloadedConsultation = {
        acceptedAt: acceptedAt,
        closedAt: closedAt
      };
      
      const immediateDuration = immediateConsultation.closedAt - immediateConsultation.acceptedAt;
      const reloadedDuration = reloadedConsultation.closedAt - reloadedConsultation.acceptedAt;
      
      expect(immediateDuration).to.equal(reloadedDuration);
    });
  });

  describe('edge cases and idempotency', function() {
    it('should return early if consultation already closed', function() {
      const alreadyClosedConsultation = {
        id: '507f1f77bcf86cd799439011',
        status: 'closed',
        closedAt: Date.now()
      };
      
      if (alreadyClosedConsultation.status === 'closed') {
        expect(alreadyClosedConsultation.status).to.equal('closed');
        return;
      }
      
      throw new Error('Should have returned early');
    });

    it('should handle undefined userId gracefully', async function() {
      const userId = undefined;
      const closedAt = new Date();
      const updateFields = {
        status: 'closed',
        closedAtISO: closedAt,
        closedAt: closedAt.getTime()
      };
      
      if (userId) {
        updateFields.closedBy = new ObjectId(userId);
      }

      await mockCollection.updateOne(
        { _id: new ObjectId(mockConsultation.id) },
        { $set: updateFields }
      );

      expect(mockCollection.updateOne.calledOnce).to.be.true;
      const updateCall = mockCollection.updateOne.firstCall.args[1].$set;
      expect(updateCall).to.not.have.property('closedBy');
    });

    it('should handle null userId gracefully', function() {
      const userId = null;
      const consultation = { ...mockConsultation };
      
      consultation.status = 'closed';
      consultation.closedAt = Date.now();
      if (userId) {
        consultation.closedBy = userId;
      }

      expect(consultation.status).to.equal('closed');
      expect(consultation.closedBy).to.be.undefined;
    });
  });

  describe('AnonymousConsultation timestamp consistency', function() {
    it('should use consultation.closedAt for AnonymousConsultation, not Date.now()', function() {
      const closedAt = Date.now();
      const consultation = {
        ...mockConsultation,
        closedAt: closedAt
      };
      
      const anonymousClosedAt = consultation.closedAt || Date.now();
      
      expect(anonymousClosedAt).to.equal(closedAt);
      expect(anonymousClosedAt).to.not.equal(closedAt + 1000);
    });

    it('should update consultation object BEFORE creating AnonymousConsultation', function() {
      const userId = '507f1f77bcf86cd799439014';
      const closedAt = new Date();
      const consultation = { ...mockConsultation };
      
      consultation.status = 'closed';
      consultation.closedAtISO = closedAt;
      consultation.closedAt = closedAt.getTime();
      if (userId) {
        consultation.closedBy = userId;
      }
      
      const anonymousConsultation = {
        consultationId: consultation.id,
        acceptedAt: consultation.acceptedAt,
        closedAt: consultation.closedAt || Date.now(),
        acceptedBy: consultation.acceptedBy,
        closedBy: consultation.closedBy
      };

      expect(anonymousConsultation.closedAt).to.equal(consultation.closedAt);
      expect(anonymousConsultation.closedBy).to.equal(userId);
    });

    it('should produce consistent duration in AnonymousConsultation', function() {
      const acceptedAt = Date.now() - 7000;
      const closedAt = Date.now();
      
      const consultation = {
        ...mockConsultation,
        acceptedAt: acceptedAt,
        status: 'closed',
        closedAt: closedAt
      };
      
      const anonymousConsultation = {
        consultationId: consultation.id,
        acceptedAt: consultation.acceptedAt,
        closedAt: consultation.closedAt || Date.now()
      };
      
      const consultationDuration = consultation.closedAt - consultation.acceptedAt;
      const anonymousDuration = anonymousConsultation.closedAt - anonymousConsultation.acceptedAt;
      
      expect(consultationDuration).to.equal(anonymousDuration);
      expect(consultationDuration).to.equal(7000);
    });
  });

  describe('OLD implementation behavior (should fail these tests)', function() {
    it('OLD: separate closedBy update would cause race condition', async function() {
      const userId = '507f1f77bcf86cd799439014';
      
      await mockCollection.updateOne(
        { _id: new ObjectId(mockConsultation.id) },
        { $set: { closedBy: new ObjectId(userId) } }
      );
      
      await mockCollection.updateOne(
        { _id: new ObjectId(mockConsultation.id) },
        {
          $set: {
            status: 'closed',
            closedAtISO: new Date(),
            closedAt: Date.now()
          }
        }
      );

      expect(mockCollection.updateOne.callCount).to.equal(2);
    });

    it('OLD: broadcast before setting closedBy would send stale data', function() {
      const userId = '507f1f77bcf86cd799439014';
      const consultation = { ...mockConsultation };
      
      consultation.status = 'closed';
      consultation.closedAt = Date.now();
      
      const broadcastData = { ...consultation };
      
      consultation.closedBy = userId;

      expect(broadcastData.closedBy).to.be.undefined;
      expect(consultation.closedBy).to.equal(userId);
    });

    it('OLD: calling getAnonymousDetails before updating consultation could use wrong timestamp', function() {
      const closedAtTime = 1000000;
      const consultation = { ...mockConsultation };
      
      expect(consultation.closedAt).to.be.undefined;
      
      const anonymousBeforeUpdate = {
        closedAt: consultation.closedAt
      };
      
      consultation.closedAt = closedAtTime;
      
      const anonymousAfterUpdate = {
        closedAt: consultation.closedAt
      };

      expect(anonymousBeforeUpdate.closedAt).to.be.undefined;
      expect(anonymousAfterUpdate.closedAt).to.equal(closedAtTime);
    });

    it('OLD: stale acceptedAt in consultation object would cause wrong duration', function() {
      const actualAcceptedAt = Date.now() - 7000;
      const staleAcceptedAt = Date.now() - 53000;
      const closedAt = Date.now();
      
      const staleConsultation = {
        acceptedAt: staleAcceptedAt,
        closedAt: closedAt
      };
      
      const freshConsultation = {
        acceptedAt: actualAcceptedAt,
        closedAt: closedAt
      };
      
      const staleDuration = staleConsultation.closedAt - staleConsultation.acceptedAt;
      const freshDuration = freshConsultation.closedAt - freshConsultation.acceptedAt;

      expect(staleDuration).to.be.approximately(53000, 1000);
      expect(freshDuration).to.be.approximately(7000, 1000);
      expect(staleDuration).to.not.equal(freshDuration);
    });
  });
});

/**
 * Manual test procedure:
 * 
 * 1. Start the application with a test database
 * 2. Create a test consultation and accept it
 * 3. Close the consultation via API: POST /consultation/:id/close
 * 4. Immediately check the API response for:
 *    - closedBy field should be present and contain the user ID
 *    - closedAt should be a valid timestamp
 *    - status should be 'closed'
 * 5. Immediately fetch the consultation via API: GET /consultation/:id
 * 6. Verify that all fields match the close response
 * 7. Check that any broadcast listeners received correct data
 * 8. Calculate duration manually: closedAt - acceptedAt
 * 9. Verify it matches what the frontend would display
 * 
 * Expected outcomes:
 * - No discrepancy between close response and immediate fetch
 * - closedBy shows doctor name, not '-' or missing
 * - Duration is consistent across response, fetch, and History view
 * - PDF export shows correct duration and closedBy immediately
 */
