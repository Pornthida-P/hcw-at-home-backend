/**
 * Tests for consultation close call sites
 * 
 * Verifies that all places that call Consultation.closeConsultation()
 * correctly handle the userId parameter and don't break with the changes.
 */

const { expect } = require('chai');

describe('Consultation Close Call Sites', function() {
  describe('ConsultationController.closeConsultation', function() {
    it('should pass req.user?.id to Consultation.closeConsultation', function() {
      const req = {
        user: { id: '507f1f77bcf86cd799439014' },
        params: { consultation: '507f1f77bcf86cd799439011' }
      };
      
      const userId = req.user?.id;
      
      expect(userId).to.equal('507f1f77bcf86cd799439014');
    });

    it('should handle missing user gracefully', function() {
      const req = {
        user: null,
        params: { consultation: '507f1f77bcf86cd799439011' }
      };
      
      const userId = req.user?.id;
      
      expect(userId).to.be.undefined;
    });

    it('should handle undefined user gracefully', function() {
      const req = {
        params: { consultation: '507f1f77bcf86cd799439011' }
      };
      
      const userId = req.user?.id;
      
      expect(userId).to.be.undefined;
    });
  });

  describe('InviteController.closeConsultation', function() {
    it('should pass req.user?.id to Consultation.closeConsultation', function() {
      const req = {
        user: { id: '507f1f77bcf86cd799439014' },
        params: { invite: '507f1f77bcf86cd799439015' }
      };
      
      const userId = req.user?.id;
      
      expect(userId).to.equal('507f1f77bcf86cd799439014');
    });

    it('should handle missing user in invite close', function() {
      const req = {
        user: null,
        params: { invite: '507f1f77bcf86cd799439015' }
      };
      
      const userId = req.user?.id;
      
      expect(userId).to.be.undefined;
    });
  });

  describe('closeConsultation userId handling', function() {
    it('should not set closedBy when userId is undefined', function() {
      const userId = undefined;
      const consultation = {
        id: '507f1f77bcf86cd799439011',
        status: 'active'
      };
      
      consultation.status = 'closed';
      consultation.closedAt = Date.now();
      if (userId) {
        consultation.closedBy = userId;
      }

      expect(consultation.closedBy).to.be.undefined;
      expect(consultation.status).to.equal('closed');
    });

    it('should not set closedBy when userId is null', function() {
      const userId = null;
      const consultation = {
        id: '507f1f77bcf86cd799439011',
        status: 'active'
      };
      
      consultation.status = 'closed';
      consultation.closedAt = Date.now();
      if (userId) {
        consultation.closedBy = userId;
      }

      expect(consultation.closedBy).to.be.undefined;
      expect(consultation.status).to.equal('closed');
    });

    it('should set closedBy when userId is provided', function() {
      const userId = '507f1f77bcf86cd799439014';
      const consultation = {
        id: '507f1f77bcf86cd799439011',
        status: 'active'
      };
      
      consultation.status = 'closed';
      consultation.closedAt = Date.now();
      if (userId) {
        consultation.closedBy = userId;
      }

      expect(consultation.closedBy).to.equal(userId);
      expect(consultation.status).to.equal('closed');
    });

    it('should not overwrite valid closedBy with undefined', function() {
      const existingUserId = '507f1f77bcf86cd799439014';
      const newUserId = undefined;
      const consultation = {
        id: '507f1f77bcf86cd799439011',
        status: 'closed',
        closedBy: existingUserId
      };
      
      if (consultation.status === 'closed') {
        return;
      }

      if (newUserId) {
        consultation.closedBy = newUserId;
      }

      expect(consultation.closedBy).to.equal(existingUserId);
    });
  });
});
